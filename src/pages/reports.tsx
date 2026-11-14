import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Button, Card, Label, TextInput } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dashboard, saveMoney, savePurchase, revertMoney, revertPurchase, revertBill } from "@/lib/store";
import { type Account, type Bill, type BillLine, type MoneyEntry, type Party, type Purchase } from "@/lib/types";
import { cn, formatDate, formatKg, round2, todayISO, LIVE_FROM } from "@/lib/utils";

type Dash = Awaited<ReturnType<typeof dashboard>>;
type Tab = "ledger" | "sales" | "purchases" | "stock" | "debtors";

const BUSINESS = "United Coal Depot";
const num = (x: string) => Number(x) || 0;
const day = (s?: string | null) => (s || "").slice(0, 10);
const isZero = (x: number) => Math.abs(x) < 0.005;

/* ---------- formatting ---------- */

/** Compact Indian amount: no paise when .00, no currency sign. */
function fmtAmt(x: number): string {
  const v = Math.abs(round2(x));
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
}
const rupee = (x: number) => `${x < 0 ? "−" : ""}₹${fmtAmt(x)}`;
const fmtBal = (x: number) => (isZero(x) ? "0" : `${fmtAmt(x)} ${x > 0 ? "Dr" : "Cr"}`);
const fmtQty = (x: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(x);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "03 Nov" (adds the year only when it is not the current one). */
function shortDate(iso: string): string {
  const s = day(iso);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  const base = `${d} ${MONTHS[Number(m) - 1] ?? m}`;
  return Number(y) === new Date().getFullYear() ? base : `${base} ${y.slice(2)}`;
}

function balanceWords(name: string, bal: number): string {
  if (isZero(bal)) return "Account is settled — nothing due either way.";
  return bal > 0 ? `${name} owes you ${rupee(bal)}` : `You owe ${name} ${rupee(Math.abs(bal))}`;
}

/* ---------- date ranges ---------- */

type Preset = "month" | "last" | "fy" | "all" | "custom";
interface Range { preset: Preset; from: string; to: string } // "" = open ended

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(preset: Exclude<Preset, "custom">): Range {
  const now = new Date();
  const today = todayISO();
  if (preset === "month") return { preset, from: isoOf(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (preset === "last") {
    return {
      preset,
      from: isoOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: isoOf(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  if (preset === "fy") {
    const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY: 1 Apr – 31 Mar
    return { preset, from: `${y}-04-01`, to: today };
  }
  return { preset: "all", from: "", to: "" };
}

const inRange = (date: string, r: Range) => (!r.from || date >= r.from) && (!r.to || date <= r.to);

function periodLabel(r: Range): string {
  if (!r.from && !r.to) return "All entries";
  if (!r.from) return `Up to ${formatDate(r.to)}`;
  if (!r.to) return `From ${formatDate(r.from)}`;
  return `${formatDate(r.from)} – ${formatDate(r.to)}`;
}

const PRESETS: { id: Exclude<Preset, "custom">; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "last", label: "Last month" },
  { id: "fy", label: "This FY" },
  { id: "all", label: "All" },
];

function RangeBar({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  return (
    <div className="space-y-2 print:hidden">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(rangeFor(p.id))}
            className={cn(
              "h-9 rounded-full border px-3 text-sm font-medium",
              range.preset === p.id ? "border-primary bg-primary text-primary-fg" : "border-border bg-card text-fg",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <Label className="mb-0.5 text-xs">From</Label>
          <TextInput className="h-10 min-w-0 px-2 text-sm" type="date" value={range.from} onChange={(e) => onChange({ preset: "custom", from: e.target.value, to: range.to })} />
        </div>
        <div className="min-w-0">
          <Label className="mb-0.5 text-xs">To</Label>
          <TextInput className="h-10 min-w-0 px-2 text-sm" type="date" value={range.to} onChange={(e) => onChange({ preset: "custom", from: range.from, to: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

/* ---------- ledger building ---------- */

interface LedgerRow {
  key: string;
  date: string;
  ts: string;
  idx: number;
  title: string;
  detail: string;
  dr: number;
  cr: number;
  kind: "bill" | "purchase" | "money";
  source: any;
  pending?: boolean;
}

const stamp = (x: any): string => String(x?.created_at ?? x?.createdAt ?? "");

function linesText(lines: BillLine[] | undefined): string {
  return (lines || []).map((l) => `${l.itemName} ${fmtQty(Math.abs(l.kg))} kg @ ₹${fmtAmt(l.rate)}`).join(", ");
}

function cleanNotes(notes: string | undefined): string {
  const t = (notes || "").trim();
  if (!t || /^via telegram\.?$/i.test(t) || /^quick posting$/i.test(t)) return "";
  return t;
}

/** Every entry that belongs in this party's ledger, oldest first. */
function buildLedger(d: Dash, partyId: string): LedgerRow[] {
  const accName = (id: string | null | undefined) => d.accounts.find((a: Account) => a.id === id)?.name || "";
  const rows: LedgerRow[] = [];
  let idx = 0;

  // Only posted CREDIT sales hit the party; walk-in / prepaid are cash sales.
  d.bills.forEach((b: Bill) => {
    if (b.partyId !== partyId || !b.isPosted || b.saleType !== "credit_delivery") return;
    const isReturn = b.total < 0;
    const parts = [linesText(b.lines)];
    if (b.deliveryCharge) parts.push(`Delivery ₹${fmtAmt(b.deliveryCharge)}`);
    rows.push({
      key: `bill-${b.id}`, date: day(b.date), ts: stamp(b), idx: idx++,
      title: isReturn ? "Sales return" : "Sale",
      detail: parts.filter(Boolean).join(" + "),
      dr: isReturn ? 0 : b.total, cr: isReturn ? Math.abs(b.total) : 0,
      kind: "bill", source: b,
    });
  });

  // Only CREDIT purchases (no account) hit the party.
  d.purchases.forEach((p: Purchase) => {
    if (p.partyId !== partyId || p.accountId) return;
    const isReturn = p.total < 0;
    rows.push({
      key: `purchase-${p.id}`, date: day(p.date), ts: stamp(p), idx: idx++,
      title: isReturn ? "Purchase return" : "Purchase",
      detail: `${p.itemName} ${fmtQty(Math.abs(p.kg))} kg @ ₹${fmtAmt(p.rate)}`,
      dr: isReturn ? Math.abs(p.total) : 0, cr: isReturn ? 0 : p.total,
      kind: "purchase", source: p,
    });
  });

  d.money.forEach((m: MoneyEntry) => {
    if (m.partyId !== partyId) return;
    const base = { key: `money-${m.id}`, date: day(m.date), ts: stamp(m), idx: idx++, kind: "money" as const, source: m };
    const acc = accName(m.accountId);
    const notes = cleanNotes(m.notes);
    if (m.type === "payment_in") {
      rows.push({ ...base, title: acc ? `Received – ${acc}` : "Received", detail: notes, dr: 0, cr: m.amount });
    } else if (m.type === "payment_out") {
      rows.push({ ...base, title: acc ? `Paid – ${acc}` : "Paid", detail: notes, dr: m.amount, cr: 0 });
    } else if (m.type === "pdc_in") {
      const chq = m.chequeNumber ? `Cheque #${m.chequeNumber}` : "Cheque";
      if (m.status === "cleared") {
        rows.push({ ...base, title: `${chq} cleared${acc ? ` – ${acc}` : ""}`, detail: notes, dr: 0, cr: m.amount });
      } else {
        rows.push({
          ...base, pending: true, dr: 0, cr: 0,
          title: `PDC pending – ${chq.toLowerCase().replace("cheque", "chq")}`,
          detail: [`₹${fmtAmt(m.amount)}`, m.clearanceDate ? `due ${shortDate(m.clearanceDate)}` : "", notes].filter(Boolean).join(", "),
        });
      }
    }
  });

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.ts.localeCompare(b.ts) || a.idx - b.idx);
  return rows;
}

const rowText = (r: LedgerRow) => (r.detail ? `${r.title}: ${r.detail}` : r.title);

function downloadCSV(data: any[][], filename: string) {
  const csv = data.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function waNumber(phone: string | undefined): string {
  const digits = (phone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return "";
}

/* ---------- small shared pieces ---------- */

const TD = "px-1 py-2 align-top sm:px-2";
const TDN = `${TD} text-right whitespace-nowrap`;
const TH = "px-1 py-2 text-[11px] font-semibold text-muted sm:px-2 sm:text-xs";
const TABLE = "w-full border-collapse text-xs tabular-nums sm:text-sm";
// Edge-to-edge on phones so five columns fit in 360px; a normal card from sm up.
const TABLE_CARD = "-mx-4 overflow-x-auto rounded-none border-x-0 p-0 sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border-x";

/** Balance for table cells: "12,000 Dr" with a small Dr/Cr suffix. */
function Bal({ value }: { value: number }) {
  if (isZero(value)) return <>0</>;
  return <>{fmtAmt(value)}<span className="ml-0.5 text-[10px] font-medium sm:text-xs">{value > 0 ? "Dr" : "Cr"}</span></>;
}

function SmallBtn({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn("inline-flex h-9 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-card px-3 text-sm font-medium disabled:opacity-50", className)}
      {...props}
    />
  );
}

function SectionHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3 pb-2">
      <div className="min-w-0">
        <h2 className="font-display text-lg leading-tight">{title}</h2>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      <div className="flex gap-2 print:hidden">{children}</div>
    </div>
  );
}

interface EditState {
  kind: "money" | "purchase";
  key: string;
  source: any;
  date: string;
  amount: string;
  notes: string;
  kg: string;
  rate: string;
}

/* ---------- page ---------- */

export function Reports() {
  const { user } = useAuth();
  const [d, setD] = useState<Dash | null>(null);
  const [tab, setTab] = useState<Tab>("ledger");

  const [ledgerRange, setLedgerRange] = useState<Range>(() => rangeFor("all"));
  const [regRange, setRegRange] = useState<Range>(() => rangeFor("month"));

  const [partyId, setPartyId] = useState(() => new URLSearchParams(window.location.search).get("party") || "");
  const [pickerOpen, setPickerOpen] = useState(true);
  const [search, setSearch] = useState("");

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => { if (user) return dashboard(user.uid).then(setD); };
  useEffect(() => { void refresh(); }, [user]);

  if (!d) return <p className="p-4">Loading reports…</p>;

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setEdit(null);
      setOpenKey(null);
    } catch (err) {
      alert(`Could not save: ${(err as Error)?.message || err}`);
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  // saveMoney / savePurchase reverse the old effect themselves when given an id,
  // so an edit is a single save call (reverting first would delete the row).
  const saveEdit = () => {
    if (!user || !edit) return;
    if (!edit.date) return alert("Pick a date.");
    if (edit.kind === "money") {
      const src = edit.source as MoneyEntry;
      if (num(edit.amount) <= 0) return alert("Enter an amount.");
      void run(() => saveMoney(user.uid, { ...src, amount: num(edit.amount), date: edit.date, notes: edit.notes }, src.id));
    } else {
      const src = edit.source as Purchase;
      if (!num(edit.kg) || num(edit.rate) <= 0) return alert("Enter kg and rate.");
      void run(() => savePurchase(user.uid, { ...src, kg: num(edit.kg), rate: num(edit.rate), total: round2(num(edit.kg) * num(edit.rate)), date: edit.date }, src.id));
    }
  };

  const del = (kind: "bill" | "purchase" | "money", source: any) => {
    if (!user || !source?.id) return;
    const msg =
      kind === "bill" ? "Permanently delete this bill? Stock and ledger balances will be reversed."
      : kind === "purchase" ? "Permanently delete this purchase? Stock and balances will be reversed."
      : "Permanently delete this entry? Balances will be reversed.";
    if (!confirm(msg)) return;
    void run(() => (kind === "bill" ? revertBill(user.uid, source.id) : kind === "purchase" ? revertPurchase(user.uid, source.id) : revertMoney(user.uid, source.id)));
  };

  const startEdit = (kind: "money" | "purchase", key: string, source: any) =>
    setEdit({
      kind, key, source,
      date: day(source.date),
      amount: String(source.amount ?? ""),
      notes: source.notes ?? "",
      kg: String(source.kg ?? ""),
      rate: String(source.rate ?? ""),
    });

  /** Row that appears under a tapped entry: Edit / Delete, or the edit form. */
  const actionRow = (key: string, kind: "bill" | "purchase" | "money", source: any, colSpan: number) => {
    if (openKey !== key) return null;
    const editing = edit && edit.key === key ? edit : null;
    return (
      <tr className="border-b border-border bg-surface print:hidden">
        <td colSpan={colSpan} className="px-3 py-2">
          {editing ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold">{editing.kind === "money" ? "Edit entry" : `Edit purchase (${source.itemName})`}</p>
              {editing.kind === "money" ? (
                <div className="grid grid-cols-2 gap-2">
                  <TextInput className="h-10 min-w-0 px-2 text-sm" type="date" value={editing.date} onChange={(e) => setEdit({ ...editing, date: e.target.value })} />
                  <TextInput className="h-10 min-w-0" placeholder="Amount" inputMode="decimal" value={editing.amount} onChange={(e) => setEdit({ ...editing, amount: e.target.value })} />
                  <TextInput className="col-span-2 h-10" placeholder="Notes" value={editing.notes} onChange={(e) => setEdit({ ...editing, notes: e.target.value })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <TextInput className="col-span-2 h-10 min-w-0 px-2 text-sm" type="date" value={editing.date} onChange={(e) => setEdit({ ...editing, date: e.target.value })} />
                  <TextInput className="h-10 min-w-0" placeholder="Kg" inputMode="decimal" value={editing.kg} onChange={(e) => setEdit({ ...editing, kg: e.target.value })} />
                  <TextInput className="h-10 min-w-0" placeholder="Rate" inputMode="decimal" value={editing.rate} onChange={(e) => setEdit({ ...editing, rate: e.target.value })} />
                  <p className="col-span-2 text-sm text-muted">Total {rupee(round2(num(editing.kg) * num(editing.rate)))}</p>
                </div>
              )}
              <div className="flex gap-2">
                <SmallBtn className="border-primary bg-primary text-primary-fg" disabled={busy} onClick={saveEdit}>{busy ? "Saving…" : "Save"}</SmallBtn>
                <SmallBtn disabled={busy} onClick={() => setEdit(null)}>Cancel</SmallBtn>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {kind !== "bill" && <SmallBtn disabled={busy} onClick={() => startEdit(kind, key, source)}>Edit</SmallBtn>}
              <SmallBtn className="border-danger/40 text-danger" disabled={busy} onClick={() => del(kind, source)}>Delete</SmallBtn>
              <SmallBtn className="ml-auto border-transparent bg-transparent text-muted" onClick={() => setOpenKey(null)}>Close</SmallBtn>
              {kind === "bill" && <p className="basis-full text-xs text-muted">Bills can't be edited — delete and make it again.</p>}
            </div>
          )}
        </td>
      </tr>
    );
  };

  const toggle = (key: string) => { setEdit(null); setOpenKey(openKey === key ? null : key); };
  const rowCls = (key: string, i: number) =>
    cn("cursor-pointer border-b border-border/70", i % 2 === 1 && "bg-surface/60", openKey === key && "bg-primary/10");

  /* ----- ledger ----- */
  const party: Party | undefined = d.parties.find((p) => p.id === partyId);
  const allRows = party ? buildLedger(d, party.id) : [];
  const range = ledgerRange;
  const opening = round2((party?.openingBalance || 0) + allRows.filter((r) => range.from && r.date < range.from).reduce((s, r) => s + r.dr - r.cr, 0));
  const rows = allRows.filter((r) => inRange(r.date, range));
  let run_ = opening;
  const withBal = rows.map((r) => { run_ = round2(run_ + r.dr - r.cr); return { r, bal: run_ }; });
  const totalDr = round2(rows.reduce((s, r) => s + r.dr, 0));
  const totalCr = round2(rows.reduce((s, r) => s + r.cr, 0));
  const closing = round2(opening + totalDr - totalCr);
  const today = todayISO();
  const openDate = range.from || [LIVE_FROM, ...allRows.slice(0, 1).map((r) => r.date)].sort()[0];
  const closeDate = range.to || today;
  const upToDate = !range.to || range.to >= today;
  const mismatch = party && upToDate && !isZero(closing - (party.currentBalance || 0)) ? round2((party.currentBalance || 0) - closing) : 0;

  const q = search.trim().toLowerCase();
  const pickList = [...d.parties]
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.phone || "").includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const choose = (id: string) => { setPartyId(id); setPickerOpen(false); setSearch(""); setOpenKey(null); setEdit(null); };

  const exportLedger = () => {
    if (!party) return;
    const balCols = (b: number) => [isZero(b) ? 0 : Math.abs(b), isZero(b) ? "" : b > 0 ? "Dr" : "Cr"];
    downloadCSV(
      [
        [BUSINESS], [`Ledger: ${party.name}`], [`Period: ${periodLabel(range)}`], [],
        ["Date", "Particulars", "Debit", "Credit", "Balance", "Dr/Cr"],
        [openDate, "Opening balance", opening > 0 ? opening : "", opening < 0 ? Math.abs(opening) : "", ...balCols(opening)],
        ...withBal.map(({ r, bal }) => [r.date, rowText(r), r.dr || "", r.cr || "", ...balCols(bal)]),
        ["", "Period total", totalDr, totalCr, "", ""],
        [closeDate, "Closing balance", "", "", ...balCols(closing)],
      ],
      `${party.name}_ledger.csv`,
    );
  };

  const shareWhatsApp = () => {
    if (!party) return;
    const real = withBal.filter(({ r }) => !r.pending);
    const last = real.slice(-15);
    const lines = [
      `*${BUSINESS}*`,
      `Account statement: *${party.name}*`,
      `Period: ${periodLabel(range)}`,
      "",
      `Opening balance: ₹${fmtBal(opening)}`,
    ];
    if (real.length > last.length) lines.push(`(last ${last.length} of ${real.length} entries)`);
    last.forEach(({ r, bal }) => {
      lines.push(`${shortDate(r.date)}: ${rowText(r)} — ${r.dr ? `Dr ₹${fmtAmt(r.dr)}` : `Cr ₹${fmtAmt(r.cr)}`} (Bal ${fmtBal(bal)})`);
    });
    if (!real.length) lines.push("No entries in this period.");
    lines.push("", `*Closing balance: ₹${fmtBal(closing)}*`);
    if (!isZero(closing)) lines.push(closing > 0 ? `Amount payable by you: ₹${fmtAmt(closing)}` : `Amount payable by us: ₹${fmtAmt(closing)}`);
    const n = waNumber(party.phone);
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

  /* ----- registers ----- */
  const sales = d.bills
    .filter((b) => b.isPosted && inRange(day(b.date), regRange))
    .sort((a, b) => day(a.date).localeCompare(day(b.date)) || stamp(a).localeCompare(stamp(b)));
  const salesTotal = round2(sales.reduce((s, b) => s + b.total, 0));
  const salesCredit = round2(sales.filter((b) => b.saleType === "credit_delivery").reduce((s, b) => s + b.total, 0));
  const purchases = d.purchases
    .filter((p) => inRange(day(p.date), regRange))
    .sort((a, b) => day(a.date).localeCompare(day(b.date)) || stamp(a).localeCompare(stamp(b)));
  const purTotal = round2(purchases.reduce((s, p) => s + p.total, 0));
  const purKg = purchases.reduce((s, p) => s + p.kg, 0);
  const receivable = d.parties.filter((p) => p.currentBalance > 0.004).sort((a, b) => b.currentBalance - a.currentBalance);
  const payable = d.parties.filter((p) => p.currentBalance < -0.004).sort((a, b) => a.currentBalance - b.currentBalance);
  const recTotal = round2(receivable.reduce((s, p) => s + p.currentBalance, 0));
  const payTotal = round2(payable.reduce((s, p) => s + Math.abs(p.currentBalance), 0));
  const SALE_TYPE: Record<string, string> = { walkin: "Cash", credit_delivery: "Credit", prepaid_delivery: "Prepaid" };

  const TABS: { id: Tab; label: string }[] = [
    { id: "ledger", label: "Ledger" },
    { id: "sales", label: "Sales" },
    { id: "purchases", label: "Purchase" },
    { id: "stock", label: "Stock" },
    { id: "debtors", label: "Dues" },
  ];

  const duesTable = (title: string, list: Party[], total: number, tone: string) => (
    <Card className={TABLE_CARD}>
      <SectionHead title={title} sub={`${list.length} ${list.length === 1 ? "party" : "parties"}`} />
      <table className={TABLE}>
        <tbody>
          {list.map((p, i) => (
            <tr key={p.id} className={cn("cursor-pointer border-b border-border/70", i % 2 === 1 && "bg-surface/60")} onClick={() => { choose(p.id); setTab("ledger"); window.scrollTo(0, 0); }}>
              <td className={cn(TD, "pl-2.5 sm:pl-4 [overflow-wrap:anywhere]")}>
                {p.name}
                <span className="block text-[11px] text-muted capitalize">{p.kind}</span>
              </td>
              <td className={cn(TDN, "pr-2.5 sm:pr-4 font-medium", tone)}>{rupee(Math.abs(p.currentBalance))}</td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={2} className="px-3 py-4 text-center text-muted">Nothing here.</td></tr>}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-fg/40 font-bold">
            <td className={cn(TD, "pl-2.5 sm:pl-4")}>Total</td>
            <td className={cn(TDN, "pr-2.5 sm:pr-4", tone)}>{rupee(total)}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );

  return (
    <div className="space-y-4 pb-12 print:space-y-2 print:pb-0">
      <h1 className="font-display text-3xl print:hidden">Reports</h1>

      <div className="grid grid-cols-5 overflow-hidden rounded-[var(--radius-md)] border border-border bg-card print:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setTab(t.id); setOpenKey(null); setEdit(null); }}
            className={cn("h-11 text-[13px] font-medium sm:text-sm", tab === t.id ? "bg-primary text-primary-fg" : "text-muted")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ================= PARTY LEDGER ================= */}
      {tab === "ledger" && (
        <>
          {(pickerOpen || !party) && (
            <Card className="p-3 print:hidden">
              <Label className="text-xs">Choose party</Label>
              <TextInput placeholder="Search name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus={!!party} />
              <div className="mt-2 max-h-72 divide-y divide-border/70 overflow-y-auto rounded-[var(--radius-sm)] border border-border">
                {pickList.map((p) => (
                  <button key={p.id} type="button" onClick={() => choose(p.id)} className={cn("flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left", p.id === partyId && "bg-primary/10")}>
                    <span className="min-w-0">
                      <span className="block [overflow-wrap:anywhere] text-[15px] font-medium leading-tight">{p.name}</span>
                      <span className="text-xs text-muted capitalize">{p.kind}</span>
                    </span>
                    <span className={cn("shrink-0 text-sm tabular-nums", p.currentBalance > 0 ? "text-danger" : p.currentBalance < 0 ? "text-ok" : "text-muted")}>{fmtBal(p.currentBalance)}</span>
                  </button>
                ))}
                {pickList.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">{d.parties.length ? "No party matches." : "No parties yet — add them in Settings."}</p>}
              </div>
              {party && <SmallBtn className="mt-2" onClick={() => { setPickerOpen(false); setSearch(""); }}>Cancel</SmallBtn>}
            </Card>
          )}

          {party && (
            <>
              {/* Party header */}
              <Card className="print:hidden">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-xl leading-tight [overflow-wrap:anywhere]">{party.name}</h2>
                    <p className="mt-0.5 text-sm text-muted">
                      <span className="capitalize">{party.kind}</span>
                      {party.phone ? <> · <a className="underline underline-offset-2" href={`tel:${party.phone}`}>{party.phone}</a></> : null}
                    </p>
                  </div>
                  {!pickerOpen && <SmallBtn className="shrink-0" onClick={() => setPickerOpen(true)}>Change</SmallBtn>}
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Current balance</p>
                  <p className={cn("font-display text-3xl leading-tight tabular-nums", party.currentBalance > 0 ? "text-danger" : party.currentBalance < 0 ? "text-ok" : "text-fg")}>
                    ₹{fmtAmt(party.currentBalance)}
                    {!isZero(party.currentBalance) && <span className="ml-1.5 font-sans text-base font-semibold">{party.currentBalance > 0 ? "Dr" : "Cr"}</span>}
                  </p>
                  <p className="mt-0.5 text-sm">{balanceWords(party.name, party.currentBalance)}</p>
                </div>
              </Card>

              <RangeBar range={range} onChange={(r) => { setLedgerRange(r); setOpenKey(null); setEdit(null); }} />

              <div className="grid grid-cols-3 gap-2 print:hidden">
                <SmallBtn className="h-10 px-1" onClick={() => window.print()}>Print</SmallBtn>
                <SmallBtn className="h-10 border-ok bg-ok px-1 text-white" onClick={shareWhatsApp}>WhatsApp</SmallBtn>
                <SmallBtn className="h-10 px-1" onClick={exportLedger}>Export CSV</SmallBtn>
              </div>

              {/* Print-only heading */}
              <div className="hidden print:block">
                <p className="font-display text-2xl">{BUSINESS}</p>
                <p className="mt-1 text-base font-semibold">Ledger account: {party.name}{party.phone ? ` (${party.phone})` : ""}</p>
                <p className="text-sm">Period: {periodLabel(range)} · Printed {formatDate(today)}</p>
              </div>

              <Card className={cn(TABLE_CARD, "print:mx-0 print:rounded-none print:border-0 print:bg-transparent")}>
                <table className={cn(TABLE, "print:text-[10.5pt]")}>
                  <thead>
                    <tr className="border-b border-fg/40 bg-surface print:bg-transparent">
                      <th className={cn(TH, "pl-2.5 sm:pl-4 text-left print:pl-0")}>Date</th>
                      <th className={cn(TH, "text-left")}>Particulars</th>
                      <th className={cn(TH, "text-right")}>Dr</th>
                      <th className={cn(TH, "text-right")}>Cr</th>
                      <th className={cn(TH, "pr-2.5 sm:pr-4 text-right print:pr-0")}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border bg-surface/60 print:bg-transparent">
                      <td className={cn(TD, "pl-2.5 sm:pl-4 whitespace-nowrap text-muted print:pl-0")}>{shortDate(openDate)}</td>
                      <td className={cn(TD, "font-semibold")}>Opening balance</td>
                      <td className={TDN}>{opening > 0 && !isZero(opening) ? fmtAmt(opening) : ""}</td>
                      <td className={TDN}>{opening < 0 && !isZero(opening) ? fmtAmt(opening) : ""}</td>
                      <td className={cn(TDN, "pr-2.5 sm:pr-4 font-semibold print:pr-0")}><Bal value={opening} /></td>
                    </tr>

                    {withBal.map(({ r, bal }, i) => (
                      <Fragment key={r.key}>
                        <tr className={cn(rowCls(r.key, i), "print:bg-transparent", r.pending && "text-subtle italic")} onClick={() => toggle(r.key)}>
                          <td className={cn(TD, "pl-2.5 sm:pl-4 whitespace-nowrap text-muted print:pl-0")}>{shortDate(r.date)}</td>
                          <td className={cn(TD, "[overflow-wrap:anywhere]")}>
                            <span className="font-medium">{r.title}</span>
                            {r.detail && <span className="block text-[11px] leading-snug text-muted sm:text-xs print:text-[9.5pt]">{r.detail}</span>}
                          </td>
                          <td className={cn(TDN, "text-danger")}>{r.dr ? fmtAmt(r.dr) : ""}</td>
                          <td className={cn(TDN, "text-ok")}>{r.cr ? fmtAmt(r.cr) : ""}</td>
                          <td className={cn(TDN, "pr-2.5 sm:pr-4 font-medium print:pr-0")}>{r.pending ? "" : <Bal value={bal} />}</td>
                        </tr>
                        {actionRow(r.key, r.kind, r.source, 5)}
                      </Fragment>
                    ))}

                    {rows.length === 0 && (
                      <tr className="border-b border-border">
                        <td colSpan={5} className="px-3 py-5 text-center text-muted">No entries in this period.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-fg/40 text-muted">
                      <td className={cn(TD, "pl-2.5 sm:pl-4 print:pl-0")}></td>
                      <td className={cn(TD, "font-semibold")}>Period total</td>
                      <td className={cn(TDN, "font-semibold text-danger")}>{fmtAmt(totalDr)}</td>
                      <td className={cn(TDN, "font-semibold text-ok")}>{fmtAmt(totalCr)}</td>
                      <td className={cn(TDN, "pr-2.5 sm:pr-4 print:pr-0")}></td>
                    </tr>
                    <tr className="border-t-2 border-fg/50 bg-surface font-bold print:bg-transparent">
                      <td className={cn(TD, "py-2.5 pl-2.5 sm:pl-4 whitespace-nowrap print:pl-0")}>{shortDate(closeDate)}</td>
                      <td className={cn(TD, "py-2.5")}>Closing balance</td>
                      <td className={cn(TDN, "py-2.5")}></td>
                      <td className={cn(TDN, "py-2.5")}></td>
                      <td className={cn(TDN, "py-2.5 pr-2.5 sm:pr-4 print:pr-0", closing > 0 ? "text-danger" : closing < 0 ? "text-ok" : "")}><Bal value={closing} /></td>
                    </tr>
                  </tfoot>
                </table>
              </Card>

              <p className="hidden text-sm print:block">
                {isZero(closing) ? "Account settled." : closing > 0 ? `Balance receivable from ${party.name}: ₹${fmtAmt(closing)}` : `Balance payable to ${party.name}: ₹${fmtAmt(closing)}`}
              </p>

              <div className="space-y-1 px-1 text-xs text-muted print:hidden">
                {rows.length > 0 && <p>Tap an entry to edit or delete it. Dr = they owe you, Cr = you owe them.</p>}
                {mismatch !== 0 && (
                  <p className="text-danger">
                    Note: the entries add up to {fmtBal(closing)}, but the stored balance is {fmtBal(party.currentBalance)} (difference ₹{fmtAmt(mismatch)}). An older edit or a deleted entry may have caused this.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ================= SALES ================= */}
      {tab === "sales" && (
        <>
          <RangeBar range={regRange} onChange={setRegRange} />
          <Card className={TABLE_CARD}>
            <SectionHead title="Sales register" sub={periodLabel(regRange)}>
              <SmallBtn onClick={() => downloadCSV([["Date", "Customer", "Type", "Items", "Total"], ...sales.map((s) => [day(s.date), s.customerName, SALE_TYPE[s.saleType] || s.saleType, linesText(s.lines), s.total]), ["", "Total", "", "", salesTotal]], "sales.csv")}>Export CSV</SmallBtn>
            </SectionHead>
            <table className={TABLE}>
              <thead>
                <tr className="border-b border-fg/40 bg-surface">
                  <th className={cn(TH, "pl-2.5 sm:pl-4 text-left")}>Date</th>
                  <th className={cn(TH, "text-left")}>Customer / items</th>
                  <th className={cn(TH, "pr-2.5 sm:pr-4 text-right")}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => {
                  const key = `bill-${s.id}`;
                  return (
                    <Fragment key={key}>
                      <tr className={rowCls(key, i)} onClick={() => toggle(key)}>
                        <td className={cn(TD, "pl-2.5 sm:pl-4 whitespace-nowrap text-muted")}>{shortDate(s.date)}</td>
                        <td className={cn(TD, "[overflow-wrap:anywhere]")}>
                          <span className="font-medium">{s.customerName || "Walk-in"}</span>
                          <span className="ml-1.5 rounded-full border border-border px-1.5 text-[10px] uppercase text-muted">{s.total < 0 ? "Return" : SALE_TYPE[s.saleType] || s.saleType}</span>
                          <span className="block text-[11px] leading-snug text-muted sm:text-xs">{linesText(s.lines)}{s.deliveryCharge ? ` + Delivery ₹${fmtAmt(s.deliveryCharge)}` : ""}</span>
                        </td>
                        <td className={cn(TDN, "pr-2.5 sm:pr-4 font-medium", s.total < 0 && "text-danger")}>{rupee(s.total)}</td>
                      </tr>
                      {actionRow(key, "bill", s, 3)}
                    </Fragment>
                  );
                })}
                {sales.length === 0 && <tr><td colSpan={3} className="px-3 py-5 text-center text-muted">No sales in this period.</td></tr>}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-fg/40 font-bold">
                  <td className={cn(TD, "pl-2.5 sm:pl-4")}></td>
                  <td className={TD}>
                    Total ({sales.length})
                    <span className="block text-[11px] font-normal text-muted">Cash/bank {rupee(round2(salesTotal - salesCredit))} · Credit {rupee(salesCredit)}</span>
                  </td>
                  <td className={cn(TDN, "pr-2.5 sm:pr-4")}>{rupee(salesTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
          {sales.length > 0 && <p className="px-1 text-xs text-muted">Tap a bill to delete it.</p>}
        </>
      )}

      {/* ================= PURCHASES ================= */}
      {tab === "purchases" && (
        <>
          <RangeBar range={regRange} onChange={setRegRange} />
          <Card className={TABLE_CARD}>
            <SectionHead title="Purchase register" sub={periodLabel(regRange)}>
              <SmallBtn onClick={() => downloadCSV([["Date", "Supplier", "Item", "Kg", "Rate", "Mode", "Total"], ...purchases.map((p) => [day(p.date), p.supplierName, p.itemName, p.kg, p.rate, p.accountId ? "Cash" : "Credit", p.total]), ["", "Total", "", purKg, "", "", purTotal]], "purchases.csv")}>Export CSV</SmallBtn>
            </SectionHead>
            <table className={TABLE}>
              <thead>
                <tr className="border-b border-fg/40 bg-surface">
                  <th className={cn(TH, "pl-2.5 sm:pl-4 text-left")}>Date</th>
                  <th className={cn(TH, "text-left")}>Supplier / item</th>
                  <th className={cn(TH, "pr-2.5 sm:pr-4 text-right")}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p, i) => {
                  const key = `purchase-${p.id}`;
                  return (
                    <Fragment key={key}>
                      <tr className={rowCls(key, i)} onClick={() => toggle(key)}>
                        <td className={cn(TD, "pl-2.5 sm:pl-4 whitespace-nowrap text-muted")}>{shortDate(p.date)}</td>
                        <td className={cn(TD, "[overflow-wrap:anywhere]")}>
                          <span className="font-medium">{p.supplierName || "Cash purchase"}</span>
                          <span className="ml-1.5 rounded-full border border-border px-1.5 text-[10px] uppercase text-muted">{p.total < 0 ? "Return" : p.accountId ? "Cash" : "Credit"}</span>
                          <span className="block text-[11px] leading-snug text-muted sm:text-xs">{p.itemName} {fmtQty(Math.abs(p.kg))} kg @ ₹{fmtAmt(p.rate)}</span>
                        </td>
                        <td className={cn(TDN, "pr-2.5 sm:pr-4 font-medium", p.total < 0 && "text-danger")}>{rupee(p.total)}</td>
                      </tr>
                      {actionRow(key, "purchase", p, 3)}
                    </Fragment>
                  );
                })}
                {purchases.length === 0 && <tr><td colSpan={3} className="px-3 py-5 text-center text-muted">No purchases in this period.</td></tr>}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-fg/40 font-bold">
                  <td className={cn(TD, "pl-2.5 sm:pl-4")}></td>
                  <td className={TD}>Total ({purchases.length})<span className="block text-[11px] font-normal text-muted">{formatKg(purKg)}</span></td>
                  <td className={cn(TDN, "pr-2.5 sm:pr-4")}>{rupee(purTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
          {purchases.length > 0 && <p className="px-1 text-xs text-muted">Tap a purchase to edit or delete it.</p>}
        </>
      )}

      {/* ================= STOCK ================= */}
      {tab === "stock" && (
        <Card className={TABLE_CARD}>
          <SectionHead title="Godown stock" sub="As of now">
            <SmallBtn onClick={() => downloadCSV([["Item", "Current Kg", "Status", "Sold 30d Kg"], ...d.stockInsights.map((s) => [s.itemName, s.currentKg, s.status, s.soldLast30DaysKg])], "stock.csv")}>Export CSV</SmallBtn>
          </SectionHead>
          <table className={TABLE}>
            <thead>
              <tr className="border-b border-fg/40 bg-surface">
                <th className={cn(TH, "pl-2.5 sm:pl-4 text-left")}>Item</th>
                <th className={cn(TH, "text-right")}>In stock</th>
                <th className={cn(TH, "pr-2.5 sm:pr-4 text-right")}>Sold 30d</th>
              </tr>
            </thead>
            <tbody>
              {d.stockInsights.map((s, i) => (
                <tr key={s.itemId} className={cn("border-b border-border/70", i % 2 === 1 && "bg-surface/60")}>
                  <td className={cn(TD, "pl-2.5 sm:pl-4 [overflow-wrap:anywhere]")}>
                    <span className="font-medium">{s.itemName}</span>
                    {s.status !== "healthy" && <span className={cn("block text-[11px]", s.status === "low_stock" ? "text-danger" : "text-muted")}>{s.status === "low_stock" ? "Low stock" : "No sale in 30 days"}</span>}
                  </td>
                  <td className={cn(TDN, "font-semibold", s.currentKg < 0 && "text-danger")}>{formatKg(s.currentKg)}</td>
                  <td className={cn(TDN, "pr-2.5 sm:pr-4 text-muted")}>{formatKg(s.soldLast30DaysKg)}</td>
                </tr>
              ))}
              {d.stockInsights.length === 0 && <tr><td colSpan={3} className="px-3 py-5 text-center text-muted">Add items in Settings first.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-fg/40 font-bold">
                <td className={cn(TD, "pl-2.5 sm:pl-4")}>Total</td>
                <td className={TDN}>{formatKg(d.stockInsights.reduce((s, x) => s + x.currentKg, 0))}</td>
                <td className={cn(TDN, "pr-2.5 sm:pr-4")}>{formatKg(d.stockInsights.reduce((s, x) => s + x.soldLast30DaysKg, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {/* ================= DUES ================= */}
      {tab === "debtors" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3">
              <p className="text-xs text-muted">To receive</p>
              <p className="text-lg font-semibold tabular-nums text-danger">{rupee(recTotal)}</p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted">To pay</p>
              <p className="text-lg font-semibold tabular-nums text-ok">{rupee(payTotal)}</p>
            </Card>
          </div>
          {duesTable("To receive", receivable, recTotal, "text-danger")}
          {duesTable("To pay", payable, payTotal, "text-ok")}
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-xs text-muted">Tap a party to open its ledger.</p>
            <SmallBtn onClick={() => downloadCSV([["Party", "Kind", "To receive", "To pay"], ...receivable.map((p) => [p.name, p.kind, p.currentBalance, ""]), ...payable.map((p) => [p.name, p.kind, "", Math.abs(p.currentBalance)]), ["Total", "", recTotal, payTotal]], "dues.csv")}>Export CSV</SmallBtn>
          </div>
        </>
      )}
    </div>
  );
}
