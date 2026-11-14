// Entry screens (v5): Create Bill, Add Stock, Payment / Expense entry.
// One form each, top to bottom, only the needed fields, Save bar fixed at the bottom, stays on the page after saving.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Card, NativeSelect, TextInput, TextArea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { listAccounts, listItems, listParties, saveBill, saveMoney, saveParty, savePurchase } from "@/lib/store";
import type { Account, BillLine, Item, Party } from "@/lib/types";
import { cn, formatINR, formatKg, round2, todayISO } from "@/lib/utils";

const num = (x: string) => Number(x) || 0;
const balText = (b: number) => (!b ? "₹0" : b > 0 ? `${formatINR(b)} Dr` : `${formatINR(-b)} Cr`);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- gate pass ----------
interface PassData { date: string; customerName: string; saleType: string; lines: BillLine[]; deliveryCharge: number; total: number; deliveryDate?: string; deliveryTime?: string; address?: string; phone?: string }

function writeGatePass(win: Window | null, d: PassData) {
  if (!win) return;
  win.document.write(`
    <html><head><title>Gate Pass - United Coal Depot</title>
    <style>
      body { font-family: monospace; padding: 20px; color: #000; }
      h2, h4 { margin: 0 0 5px 0; } p { margin: 4px 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 15px; }
      th, td { border-bottom: 1px dashed #000; padding: 6px; text-align: left; font-size: 14px; }
      .r { text-align: right; } .mt { margin-top: 15px; }
    </style></head><body>
      <h2>UNITED COAL DEPOT</h2><h4>GATE PASS / DELIVERY SLIP</h4>
      <div class="mt">
        <p><strong>Date:</strong> ${esc(d.date)}</p>
        <p><strong>Customer / Party:</strong> ${esc(d.customerName || "Walk-in")}</p>
        ${d.phone ? `<p><strong>Phone:</strong> ${esc(d.phone)}</p>` : ""}
        ${d.address ? `<p><strong>Address:</strong> ${esc(d.address)}</p>` : ""}
        <p><strong>Sale Type:</strong> ${esc(d.saleType.toUpperCase())}</p>
        ${d.deliveryDate ? `<p><strong>Delivery:</strong> ${esc(d.deliveryDate)} ${esc(d.deliveryTime || "")}</p>` : ""}
      </div>
      <table><thead><tr><th>Item</th><th class="r">Qty (Kg)</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${d.lines.map((l) => `<tr><td>${esc(l.itemName)}</td><td class="r">${l.kg}</td><td class="r">₹${l.rate}</td><td class="r">₹${l.amount}</td></tr>`).join("")}</tbody></table>
      ${d.deliveryCharge ? `<p class="mt">Delivery Charge: ₹${d.deliveryCharge}</p>` : ""}
      <h3 class="mt">Grand Total: ₹${d.total}</h3>
      <script>window.print();</script>
    </body></html>`);
  win.document.close();
}

// ---------- small building blocks ----------
function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; sub?: string }[] }) {
  return (
    <div className="grid gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "flex min-h-11 flex-col items-center justify-center rounded-[var(--radius-sm)] px-1 py-1 text-sm font-semibold leading-tight",
            value === o.id ? "bg-primary text-primary-fg" : "text-muted hover:bg-card",
          )}
        >
          {o.label}
          {o.sub ? <span className={cn("text-[10px] font-normal", value === o.id ? "text-primary-fg/75" : "text-subtle")}>{o.sub}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Searchable party box. Pick a saved party, or (when allowed) just type a one-off name. */
function PartySearch({ parties, selected, text, onSelect, onText, placeholder, createLabel, onCreate }: {
  parties: Party[]; selected: Party | null; text: string; placeholder: string;
  onSelect: (p: Party | null) => void; onText: (t: string) => void;
  createLabel?: string; onCreate?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const q = text.trim().toLowerCase();
  const matches = useMemo(
    () => parties.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.phone || "").includes(q)).slice(0, 8),
    [parties, q],
  );
  const exact = parties.some((p) => p.name.trim().toLowerCase() === q);

  if (selected) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-primary/40 bg-primary/5 px-3 py-1.5">
        <div className="min-w-0">
          <p className="truncate font-semibold">{selected.name}</p>
          <p className="text-xs text-muted">Balance {balText(selected.currentBalance || 0)}</p>
        </div>
        <button type="button" aria-label="Change party" className="shrink-0 rounded px-2 py-1 text-sm text-primary underline-offset-2 hover:underline" onClick={() => { onSelect(null); onText(""); }}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <TextInput
        placeholder={placeholder}
        value={text}
        autoComplete="off"
        onChange={(e) => { onText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 180)}
      />
      {open && (matches.length > 0 || (onCreate && q && !exact)) && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-card shadow-lg">
          {matches.map((p) => (
            <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onSelect(p); setOpen(false); }}
              className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-3 py-1.5 text-left last:border-0 hover:bg-surface">
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 text-xs text-muted">{balText(p.currentBalance || 0)}</span>
            </button>
          ))}
          {onCreate && q && !exact && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onCreate(text.trim()); setOpen(false); }}
              className="flex min-h-11 w-full items-center px-3 py-1.5 text-left font-medium text-primary hover:bg-surface">
              + {createLabel || "Add new"} “{text.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Item lines: pick item, kg, rate, Add. A filled-in row is included on Save even without tapping Add. */
function useLines(items: Item[], rateFor: (it: Item) => number | null) {
  const [lines, setLines] = useState<BillLine[]>([]);
  const [itemId, setItemId] = useState("");
  const [kg, setKg] = useState("");
  const [rate, setRate] = useState("");
  const rateRef = useRef(rateFor);
  rateRef.current = rateFor;

  useEffect(() => { if (!itemId && items[0]) setItemId(items[0].id); }, [items, itemId]);
  useEffect(() => { resetRate(); }, [itemId, items.length]); // fill the default rate once the item is known
  const resetRate = (id = itemId) => {
    const it = items.find((i) => i.id === id);
    const r = it ? rateRef.current(it) : null;
    setRate(r ? String(r) : "");
  };
  const pickItem = (id: string) => { setItemId(id); };

  const draft = (): BillLine | null => {
    const it = items.find((i) => i.id === itemId);
    if (!it || num(kg) <= 0 || num(rate) <= 0) return null;
    return { itemId: it.id, itemName: it.name, kg: num(kg), rate: num(rate), amount: round2(num(kg) * num(rate)) };
  };
  const add = () => { const d = draft(); if (d) { setLines((l) => [...l, d]); setKg(""); } return !!d; };
  const all = () => { const d = draft(); return d ? [...lines, d] : lines; };
  const clear = () => { setLines([]); setKg(""); };
  const halfTyped = num(kg) > 0 && num(rate) <= 0;
  return { lines, setLines, itemId, pickItem, kg, setKg, rate, setRate, resetRate, add, all, clear, halfTyped };
}

function LinesEditor({ items, L, rateLabel }: { items: Item[]; L: ReturnType<typeof useLines>; rateLabel: string }) {
  const draftAmt = round2(num(L.kg) * num(L.rate));
  return (
    <div className="space-y-2">
      {L.lines.length > 0 && (
        <div className="divide-y divide-border rounded-[var(--radius-sm)] border border-border bg-surface">
          {L.lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.itemName}</p>
                <p className="text-xs text-muted">{formatKg(l.kg)} × ₹{l.rate}</p>
              </div>
              <span className="font-semibold tabular-nums">{formatINR(l.amount)}</span>
              <button type="button" aria-label="Remove item" className="grid size-8 place-items-center rounded text-danger hover:bg-card" onClick={() => L.setLines(L.lines.filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-[var(--radius-sm)] border border-dashed border-border p-3">
        {items.length === 0 ? (
          <p className="text-sm text-danger">No items yet. Add an item in Settings first.</p>
        ) : items.length <= 4 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {items.map((it) => (
              <button key={it.id} type="button" onClick={() => L.pickItem(it.id)}
                className={cn("min-h-9 rounded-full border px-3 text-sm font-medium", L.itemId === it.id ? "border-primary bg-primary text-primary-fg" : "border-border bg-card text-fg")}>
                {it.name}
              </button>
            ))}
          </div>
        ) : (
          <NativeSelect className="mb-2" value={L.itemId} onChange={(e) => L.pickItem(e.target.value)}>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
          </NativeSelect>
        )}
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label="Kg">
            <TextInput inputMode="decimal" placeholder="0" value={L.kg} onChange={(e) => L.setKg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") L.add(); }} />
          </Field>
          <Field label={rateLabel}>
            <TextInput inputMode="decimal" placeholder="0" value={L.rate} onChange={(e) => L.setRate(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") L.add(); }} />
          </Field>
          <Button variant="outline" className="px-3" onClick={() => L.add()}>+ Add</Button>
        </div>
        {draftAmt > 0 && <p className="mt-1.5 text-right text-xs text-muted">= {formatINR(draftAmt)} {L.lines.length ? "(tap + Add for another item)" : ""}</p>}
      </div>
    </div>
  );
}

/** Total + buttons, fixed above the phone's bottom menu. */
function SaveBar({ label, total, error, children }: { label: string; total: number; error: string; children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-[var(--radius-md)] md:border">
      {error && <p className="mb-2 text-sm font-medium text-danger">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
          <p className="font-display text-2xl leading-none tabular-nums">{formatINR(total)}</p>
        </div>
        <div className="flex gap-2">{children}</div>
      </div>
    </div>
  );
}

function SavedNote({ text, onClose, children }: { text: string; onClose: () => void; children?: ReactNode }) {
  if (!text) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
      <span className="font-medium text-ok">✓ Saved — {text}</span>
      <span className="flex items-center gap-3">
        {children}
        <button type="button" className="text-muted" aria-label="Dismiss" onClick={onClose}>✕</button>
      </span>
    </div>
  );
}

function useMasters() {
  const { user } = useAuth();
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const reloadParties = async () => { if (user) { const p = await listParties(user.uid); setParties(p); return p; } return []; };
  const reloadAccounts = async () => { if (user) setAccounts(await listAccounts(user.uid)); };
  useEffect(() => {
    if (!user) return;
    void reloadParties(); void reloadAccounts();
    listItems(user.uid).then(setItems);
  }, [user]);
  return { user, parties, items, accounts, reloadParties, reloadAccounts };
}

function AccountPicker({ accounts, value, onChange }: { accounts: Account[]; value: string; onChange: (id: string) => void }) {
  if (accounts.length === 0) return <p className="text-sm text-danger">No cash/bank account yet. Add one in Settings first.</p>;
  if (accounts.length <= 3) return <Segmented value={value} onChange={onChange} options={accounts.map((a) => ({ id: a.id, label: a.name }))} />;
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </NativeSelect>
  );
}

// =====================================================================
// CREATE BILL
// =====================================================================
type BillMode = "cash" | "credit" | "advance";

export function BillPage() {
  const { user, parties, items, accounts, reloadParties } = useMasters();
  const customers = useMemo(() => parties.filter((p) => p.kind === "customer"), [parties]);

  const [mode, setMode] = useState<BillMode>("cash");
  const [date, setDate] = useState(todayISO());
  const [party, setParty] = useState<Party | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [account, setAccount] = useState("");
  const [later, setLater] = useState(false); // credit only: deliver later
  const [delDate, setDelDate] = useState(todayISO());
  const [delTime, setDelTime] = useState("");
  const [delCharge, setDelCharge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [lastPass, setLastPass] = useState<PassData | null>(null);

  const L = useLines(items, (it) => Number(party?.customRates?.[it.id] ?? it.baseRate) || null);
  useEffect(() => { L.resetRate(); }, [party?.id, items.length]);
  useEffect(() => { if (!account && accounts[0]) setAccount(accounts[0].id); }, [accounts, account]);

  const scheduled = mode === "advance" || (mode === "credit" && later);
  const showDelivery = scheduled;
  const lines = L.all();
  const charge = showDelivery ? num(delCharge) : 0;
  const total = round2(lines.reduce((s, l) => s + l.amount, 0) + charge);

  async function createCustomer(n: string) {
    if (!user) return;
    const id = await saveParty(user.uid, { name: n, kind: "customer", phone: "", address: "", creditDays: 7, openingBalance: 0 });
    const list = await reloadParties();
    setParty(list.find((p) => p.id === id) || null);
  }

  async function save(print: boolean) {
    setError("");
    if (!user || busy) return;
    if (L.halfTyped) return setError("Enter the rate for the item.");
    if (!lines.length) return setError("Add at least one item (kg and rate).");
    if (mode === "credit" && !party) return setError("Choose the customer for a credit bill.");
    if (mode !== "credit" && !account) return setError("Choose where the money was received.");
    const custName = party?.name || name.trim();
    if (mode === "advance" && !custName) return setError("Enter the customer name.");
    if (scheduled && !delDate) return setError("Choose the delivery date.");

    const win = print ? window.open("", "_blank") : null; // open now, while the tap is still fresh
    setBusy(true);
    try {
      const saleType = mode === "cash" ? "walkin" : mode === "credit" ? "credit_delivery" : "prepaid_delivery";
      await saveBill(user.uid, {
        date, saleType, partyId: party?.id || null,
        customerName: custName || "Walk-in",
        phone: party?.phone || phone, address: party?.address || address,
        deliveryDate: scheduled ? delDate : mode === "credit" ? date : "",
        deliveryTime: scheduled ? delTime : "",
        deliveryCharge: charge, lines, total,
        accountId: mode === "credit" ? null : account,
        paymentMethod: mode === "credit" ? "credit" : "cash",
        deliveryStatus: scheduled ? "scheduled" : mode === "credit" ? "delivered" : null,
        isPosted: false, notes: "",
      });
      const pass: PassData = {
        date, customerName: custName || "Walk-in", lines, deliveryCharge: charge, total,
        saleType: mode === "cash" ? "Cash Sale" : mode === "credit" ? (scheduled ? "Credit · Scheduled Delivery" : "Credit Sale") : "Advance Paid · Scheduled Delivery",
        deliveryDate: scheduled ? delDate : undefined, deliveryTime: scheduled ? delTime : undefined,
        phone: party?.phone || phone, address: party?.address || address,
      };
      writeGatePass(win, pass);
      setLastPass(pass);
      setSaved(`${pass.saleType} · ${pass.customerName} · ${formatINR(total)}${scheduled ? " (posts to ledger when marked delivered)" : ""}`);
      L.clear(); setParty(null); setName(""); setPhone(""); setAddress(""); setDelCharge(""); setDelTime(""); setLater(false);
      void reloadParties();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      win?.close();
      setError("Could not save: " + (e?.message || "check internet and try again"));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">Create Bill</h1>
      <SavedNote text={saved} onClose={() => setSaved("")}>
        {lastPass && <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => writeGatePass(window.open("", "_blank"), lastPass)}>Print gate pass</button>}
      </SavedNote>

      <Segmented value={mode} onChange={(m) => { setMode(m); setError(""); }} options={[
        { id: "cash", label: "Cash", sub: "paid, given now" },
        { id: "credit", label: "Credit", sub: "on khata" },
        { id: "advance", label: "Advance paid", sub: "deliver later" },
      ]} />

      <Card className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Bill date">
            <TextInput type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
          </Field>
          <Field label={mode === "cash" ? "Customer (optional)" : "Customer"} hint={mode === "cash" && !party && !name ? "Walk-in" : undefined}>
            <PartySearch
              parties={customers} selected={party} text={name}
              placeholder={mode === "credit" ? "Search customer…" : "Search, or type a name…"}
              onSelect={setParty} onText={setName}
              createLabel="Add new customer" onCreate={createCustomer}
            />
          </Field>
        </div>

        {mode === "advance" && !party && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Phone"><TextInput inputMode="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Delivery address"><TextInput placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          </div>
        )}

        <Field label="Items">
          <LinesEditor items={items} L={L} rateLabel="Rate ₹/kg" />
        </Field>

        {mode === "credit" && (
          <Field label="Delivery">
            <Segmented value={later ? "later" : "now"} onChange={(v) => setLater(v === "later")} options={[
              { id: "now", label: "Given now", sub: "goes to ledger now" },
              { id: "later", label: "Deliver later", sub: "ledger on delivery" },
            ]} />
          </Field>
        )}

        {showDelivery && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Delivery date"><TextInput type="date" value={delDate} onChange={(e) => setDelDate(e.target.value)} /></Field>
            <Field label="Time"><TextInput type="time" value={delTime} onChange={(e) => setDelTime(e.target.value)} /></Field>
            <Field label="Delivery charge ₹" className="col-span-2 sm:col-span-1"><TextInput inputMode="decimal" placeholder="0" value={delCharge} onChange={(e) => setDelCharge(e.target.value)} /></Field>
          </div>
        )}

        {mode !== "credit" && (
          <Field label="Money received in">
            <AccountPicker accounts={accounts} value={account} onChange={setAccount} />
          </Field>
        )}

        {mode === "credit" && party && total > 0 && !scheduled && (
          <p className="text-sm text-muted">Balance after this bill: <b className="text-fg">{balText(round2((party.currentBalance || 0) + total))}</b></p>
        )}
      </Card>

      <SaveBar label="Bill total" total={total} error={error}>
        <Button variant="outline" disabled={busy} onClick={() => save(false)}>{busy ? "Saving…" : "Save"}</Button>
        <Button disabled={busy} onClick={() => save(true)}>Save &amp; Print</Button>
      </SaveBar>
    </div>
  );
}

// =====================================================================
// ADD STOCK (PURCHASE)
// =====================================================================
export function PurchasePage() {
  const { user, parties, items, accounts, reloadParties } = useMasters();
  const suppliers = useMemo(() => parties.filter((p) => p.kind === "supplier"), [parties]);

  const [mode, setMode] = useState<"credit" | "cash">("credit");
  const [date, setDate] = useState(todayISO());
  const [party, setParty] = useState<Party | null>(null);
  const [name, setName] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const L = useLines(items, () => null);
  useEffect(() => { if (!account && accounts[0]) setAccount(accounts[0].id); }, [accounts, account]);

  const lines = L.all();
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));

  async function createSupplier(n: string) {
    if (!user) return;
    const id = await saveParty(user.uid, { name: n, kind: "supplier", phone: "", address: "", creditDays: 7, openingBalance: 0 });
    const list = await reloadParties();
    setParty(list.find((p) => p.id === id) || null);
  }

  async function save() {
    setError("");
    if (!user || busy) return;
    if (L.halfTyped) return setError("Enter the cost rate for the item.");
    if (!lines.length) return setError("Add at least one item (kg and cost rate).");
    if (mode === "credit" && !party) return setError("Choose the supplier for a credit purchase.");
    if (mode === "cash" && !account) return setError("Choose which account paid for it.");
    setBusy(true);
    try {
      const supplierName = party?.name || name.trim() || "Cash supplier";
      for (const l of lines) {
        await savePurchase(user.uid, {
          date, partyId: party?.id || "", supplierName,
          itemId: l.itemId, itemName: l.itemName, kg: l.kg, rate: l.rate, total: l.amount,
          accountId: mode === "cash" ? account : null, paymentMethod: mode,
        });
      }
      setSaved(`${mode === "credit" ? "Credit" : "Cash"} purchase · ${supplierName} · ${formatKg(lines.reduce((s, l) => s + l.kg, 0))} · ${formatINR(total)}`);
      L.clear(); setParty(null); setName("");
      void reloadParties();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setError("Could not save: " + (e?.message || "check internet and try again"));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">Add Stock</h1>
      <SavedNote text={saved} onClose={() => setSaved("")} />

      <Segmented value={mode} onChange={(m) => { setMode(m); setError(""); }} options={[
        { id: "credit", label: "Credit purchase", sub: "on supplier khata" },
        { id: "cash", label: "Cash purchase", sub: "paid now" },
      ]} />

      <Card className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Purchase date">
            <TextInput type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
          </Field>
          <Field label={mode === "credit" ? "Supplier" : "Supplier (optional)"}>
            <PartySearch
              parties={suppliers} selected={party} text={name}
              placeholder={mode === "credit" ? "Search supplier…" : "Search, or type a name…"}
              onSelect={setParty} onText={setName}
              createLabel="Add new supplier" onCreate={createSupplier}
            />
          </Field>
        </div>

        <Field label="Items received">
          <LinesEditor items={items} L={L} rateLabel="Cost ₹/kg" />
        </Field>

        {mode === "cash" && (
          <Field label="Paid from">
            <AccountPicker accounts={accounts} value={account} onChange={setAccount} />
          </Field>
        )}

        {mode === "credit" && party && total > 0 && (
          <p className="text-sm text-muted">Balance after this purchase: <b className="text-fg">{balText(round2((party.currentBalance || 0) - total))}</b></p>
        )}
      </Card>

      <SaveBar label="Purchase total" total={total} error={error}>
        <Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Purchase"}</Button>
      </SaveBar>
    </div>
  );
}

// =====================================================================
// PAYMENT / EXPENSE ENTRY
// =====================================================================
type MoneyMode = "payment_in" | "payment_out" | "expense" | "pdc_in";

export function MoneyPage() {
  const { user, parties, accounts, reloadParties, reloadAccounts } = useMasters();
  const [mode, setMode] = useState<MoneyMode>("payment_in");
  const [date, setDate] = useState(todayISO());
  const [party, setParty] = useState<Party | null>(null);
  const [name, setName] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [clearDate, setClearDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => { if (!account && accounts[0]) setAccount(accounts[0].id); }, [accounts, account]);
  const amt = round2(num(amount));
  const needsParty = mode !== "expense";
  const needsAccount = mode !== "pdc_in";
  const acc = accounts.find((a) => a.id === account);
  const delta = mode === "payment_in" ? -amt : mode === "payment_out" ? amt : 0;

  async function save() {
    setError("");
    if (!user || busy) return;
    if (needsParty && !party) return setError("Choose the party.");
    if (amt <= 0) return setError("Enter the amount.");
    if (needsAccount && !account) return setError("Choose the cash/bank account.");
    if (mode === "expense" && !notes.trim()) return setError("Write what the expense was for.");
    if (mode === "pdc_in" && !clearDate) return setError("Enter the cheque date.");
    setBusy(true);
    try {
      await saveMoney(user.uid, {
        date, type: mode,
        status: mode === "pdc_in" ? "pending" : undefined,
        clearanceDate: mode === "pdc_in" ? clearDate : undefined,
        chequeNumber: mode === "pdc_in" ? chequeNo : undefined,
        partyId: needsParty ? party!.id : null,
        partyName: needsParty ? party!.name : "",
        accountId: needsAccount ? account : null,
        amount: amt, notes: notes.trim(),
      });
      const what = mode === "payment_in" ? "Received from" : mode === "payment_out" ? "Paid to" : mode === "expense" ? "Expense" : "Cheque from";
      setSaved(`${what} ${needsParty ? party!.name : notes.trim()} · ${formatINR(amt)}${mode === "pdc_in" ? " (balance changes when cleared)" : ""}`);
      setParty(null); setName(""); setAmount(""); setNotes(""); setChequeNo("");
      void reloadParties(); void reloadAccounts();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setError("Could not save: " + (e?.message || "check internet and try again"));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">Payment / Expense</h1>
      <SavedNote text={saved} onClose={() => setSaved("")} />

      <Segmented value={mode} onChange={(m) => { setMode(m); setError(""); }} options={[
        { id: "payment_in", label: "Received", sub: "money in" },
        { id: "payment_out", label: "Paid", sub: "money out" },
        { id: "expense", label: "Expense" },
        { id: "pdc_in", label: "Cheque", sub: "post-dated" },
      ]} />

      <Card className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Date">
            <TextInput type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
          </Field>
          {needsParty ? (
            <Field label={mode === "payment_out" ? "Paid to" : "Received from"}>
              <PartySearch parties={parties} selected={party} text={name} placeholder="Search party…" onSelect={setParty} onText={setName} />
            </Field>
          ) : (
            <Field label="Expense for">
              <TextInput placeholder="Diesel, labour, rent…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          )}
        </div>

        <Field label="Amount ₹">
          <TextInput className="h-14 text-2xl font-semibold tabular-nums" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>

        {mode === "pdc_in" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cheque number"><TextInput inputMode="numeric" placeholder="123456" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></Field>
            <Field label="Cheque date"><TextInput type="date" value={clearDate} onChange={(e) => setClearDate(e.target.value)} /></Field>
          </div>
        ) : (
          <Field label={mode === "payment_in" ? "Received in" : "Paid from"} hint={acc ? `Balance ${formatINR(acc.balance || 0)}` : undefined}>
            <AccountPicker accounts={accounts} value={account} onChange={setAccount} />
          </Field>
        )}

        {needsParty && (
          <Field label="Notes (optional)">
            <TextArea className="min-h-16" placeholder="Any remark" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        )}

        {party && delta !== 0 && (
          <p className="text-sm text-muted">Balance after this entry: <b className="text-fg">{balText(round2((party.currentBalance || 0) + delta))}</b></p>
        )}
        {mode === "pdc_in" && <p className="text-sm text-muted">The party's balance changes only when you mark the cheque cleared on Home.</p>}
      </Card>

      <SaveBar label={mode === "payment_in" ? "Receiving" : mode === "pdc_in" ? "Cheque" : "Paying"} total={amt} error={error}>
        <Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Entry"}</Button>
      </SaveBar>
    </div>
  );
}
