// Masters (v7): Parties, Items, Accounts — moved out of Settings.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, TextInput } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dashboard, deleteAccount, deleteItem, deleteParty, saveAccount, saveItem, saveParty } from "@/lib/store";
import type { Account, Item, Party } from "@/lib/types";
import { cn, formatINR, formatKg } from "@/lib/utils";
import { Field, Segmented } from "./entry";

type Dash = Awaited<ReturnType<typeof dashboard>>;
type Tab = "parties" | "items" | "accounts";
const num = (x: string) => Number(x) || 0;
const balText = (b: number) => (!b ? "₹0" : b > 0 ? `${formatINR(b)} Dr` : `${formatINR(-b)} Cr`);

function Row({ title, sub, right, rightSub, onClick, active }: { title: string; sub?: string; right: string; rightSub?: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-14 w-full items-center justify-between gap-3 border-b border-border px-4 py-2 text-left last:border-0 hover:bg-surface", active && "bg-primary/10")}>
      <span className="min-w-0">
        <span className="block truncate font-medium">{title}</span>
        {sub ? <span className="block truncate text-xs text-muted">{sub}</span> : null}
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-semibold tabular-nums">{right}</span>
        {rightSub ? <span className="block text-xs text-muted">{rightSub}</span> : null}
      </span>
    </button>
  );
}

function FormShell({ title, error, busy, onSave, onCancel, onDelete, extra, children }: {
  title: string; error: string; busy: boolean; onSave: () => void; onCancel: () => void; onDelete?: () => void; extra?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Card className="space-y-4 border-primary/40">
      <h2 className="font-display text-xl">{title}</h2>
      {children}
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={onSave}>{busy ? "Saving…" : "Save"}</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        {extra}
        {onDelete && <button type="button" className="ml-auto px-2 py-1 text-sm text-danger underline-offset-2 hover:underline" onClick={onDelete}>Delete</button>}
      </div>
    </Card>
  );
}

export function Masters() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState<Dash | null>(null);
  const [tab, setTab] = useState<Tab>("parties");
  const [editing, setEditing] = useState<string | null>(null); // null = closed, "" = new, id = edit
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  // party form
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "customer" | "supplier">("all");
  const [pName, setPName] = useState("");
  const [pKind, setPKind] = useState<"customer" | "supplier">("customer");
  const [pPhone, setPPhone] = useState("");
  const [pAddress, setPAddress] = useState("");
  const [pDays, setPDays] = useState("7");
  const [pOpening, setPOpening] = useState("");
  const [pSide, setPSide] = useState<"dr" | "cr">("dr");
  // item form
  const [iName, setIName] = useState("");
  const [iRate, setIRate] = useState("");
  const [iOpening, setIOpening] = useState("");
  // account form
  const [aName, setAName] = useState("");
  const [aType, setAType] = useState<"cash" | "bank">("bank");
  const [aOpening, setAOpening] = useState("");

  const refresh = async () => { if (user) setD(await dashboard(user.uid)); };
  useEffect(() => { void refresh(); }, [user]);

  const parties = d?.parties || [];
  const items = d?.items || [];
  const accounts = d?.accounts || [];
  const stockOf = (id: string) => d?.stockInsights.find((s) => s.itemId === id)?.currentKg ?? 0;

  const shownParties = useMemo(() => {
    const t = q.trim().toLowerCase();
    return parties.filter((p) => (kindFilter === "all" || p.kind === kindFilter) && (!t || p.name.toLowerCase().includes(t) || (p.phone || "").includes(t)));
  }, [parties, q, kindFilter]);

  if (!d) return <p className="p-4">Loading…</p>;

  const close = () => { setEditing(null); setError(""); };
  const switchTab = (t: Tab) => { setTab(t); close(); setSaved(""); };
  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });

  // ----- open forms -----
  const openParty = (p?: Party) => {
    setError(""); setSaved(""); setEditing(p?.id ?? "");
    setPName(p?.name ?? ""); setPKind(p?.kind ?? (kindFilter === "supplier" ? "supplier" : "customer"));
    setPPhone(p?.phone ?? ""); setPAddress(p?.address ?? ""); setPDays(String(p?.creditDays ?? 7));
    setPOpening(p?.openingBalance ? String(Math.abs(p.openingBalance)) : "");
    setPSide(p ? (p.openingBalance < 0 ? "cr" : p.openingBalance > 0 ? "dr" : p.kind === "supplier" ? "cr" : "dr") : kindFilter === "supplier" ? "cr" : "dr");
    top();
  };
  const openItem = (i?: Item) => {
    setError(""); setSaved(""); setEditing(i?.id ?? "");
    setIName(i?.name ?? ""); setIRate(i ? String(i.baseRate ?? "") : ""); setIOpening(i?.openingStock ? String(i.openingStock) : "");
    top();
  };
  const openAccount = (a?: Account) => {
    setError(""); setSaved(""); setEditing(a?.id ?? "");
    setAName(a?.name ?? ""); setAType(a?.type ?? "bank"); setAOpening(a?.openingBalance ? String(a.openingBalance) : "");
    top();
  };

  const run = async (fn: () => Promise<void>, done: string) => {
    if (!user || busy) return;
    setBusy(true); setError("");
    try { await fn(); await refresh(); setSaved(done); setEditing(null); }
    catch (e: any) { setError("Could not save: " + (e?.message || "check internet and try again")); }
    finally { setBusy(false); }
  };

  // ----- save / delete -----
  const dup = (list: { id: string; name: string }[], name: string) => list.some((x) => x.id !== editing && x.name.trim().toLowerCase() === name.trim().toLowerCase());

  const saveP = () => {
    if (!pName.trim()) return setError("Enter the party name.");
    if (dup(parties, pName)) return setError("A party with this name already exists.");
    const ob = (pSide === "cr" ? -1 : 1) * Math.abs(num(pOpening));
    void run(async () => {
      await saveParty(user!.uid, { name: pName.trim(), kind: pKind, phone: pPhone.trim(), address: pAddress.trim(), creditDays: num(pDays) || 7, openingBalance: ob }, editing || undefined);
    }, `Party saved: ${pName.trim()}`);
  };
  const delP = () => {
    const used = d.bills.some((b) => b.partyId === editing) || d.purchases.some((x) => x.partyId === editing) || d.money.some((m) => m.partyId === editing);
    if (used) return setError("This party has entries, so it cannot be deleted. Delete its entries from its ledger first.");
    if (!confirm(`Delete party "${pName}"?`)) return;
    void run(async () => { await deleteParty(user!.uid, editing!); }, `Party deleted: ${pName}`);
  };

  const saveI = () => {
    if (!iName.trim()) return setError("Enter the item name.");
    if (dup(items, iName)) return setError("An item with this name already exists.");
    void run(async () => {
      await saveItem(user!.uid, { name: iName.trim(), baseRate: num(iRate), openingStock: num(iOpening) }, editing || undefined);
    }, `Item saved: ${iName.trim()}`);
  };
  const delI = () => {
    const used = d.purchases.some((x) => x.itemId === editing) || d.bills.some((b) => (b.lines || []).some((l) => l.itemId === editing));
    if (used) return setError("This item has sales or purchases, so it cannot be deleted.");
    if (!confirm(`Delete item "${iName}"?`)) return;
    void run(async () => { await deleteItem(user!.uid, editing!); }, `Item deleted: ${iName}`);
  };

  const saveA = () => {
    if (!aName.trim()) return setError("Enter the account name.");
    if (dup(accounts, aName)) return setError("An account with this name already exists.");
    void run(async () => {
      await saveAccount(user!.uid, { name: aName.trim(), type: aType, openingBalance: num(aOpening) }, editing || undefined);
    }, `Account saved: ${aName.trim()}`);
  };
  const delA = () => {
    const used = d.money.some((m) => m.accountId === editing) || d.bills.some((b) => b.accountId === editing) || d.purchases.some((x) => x.accountId === editing);
    if (used) return setError("This account has entries, so it cannot be deleted.");
    if (!confirm(`Delete account "${aName}"?`)) return;
    void run(async () => { await deleteAccount(user!.uid, editing!); }, `Account deleted: ${aName}`);
  };

  const editParty = parties.find((p) => p.id === editing);
  const editAccount = accounts.find((a) => a.id === editing);
  const receivable = parties.reduce((s, p) => s + Math.max(p.currentBalance || 0, 0), 0);
  const payable = parties.reduce((s, p) => s + Math.max(-(p.currentBalance || 0), 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Masters</h1>
        {editing === null && (
          <Button onClick={() => (tab === "parties" ? openParty() : tab === "items" ? openItem() : openAccount())}>
            + New {tab === "parties" ? "party" : tab === "items" ? "item" : "account"}
          </Button>
        )}
      </div>

      <Segmented value={tab} onChange={switchTab} options={[
        { id: "parties", label: "Parties", sub: String(parties.length) },
        { id: "items", label: "Items", sub: String(items.length) },
        { id: "accounts", label: "Accounts", sub: String(accounts.length) },
      ]} />

      {saved && (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
          <span className="font-medium text-ok">✓ {saved}</span>
          <button type="button" className="text-muted" aria-label="Dismiss" onClick={() => setSaved("")}>✕</button>
        </div>
      )}

      {/* ---------------- PARTIES ---------------- */}
      {tab === "parties" && editing !== null && (
        <FormShell title={editing ? "Edit party" : "New party"} error={error} busy={busy} onSave={saveP} onCancel={close} onDelete={editing ? delP : undefined}
          extra={editing ? <Button variant="outline" onClick={() => nav(`/reports?party=${editing}`)}>Open ledger</Button> : undefined}>
          <Field label="Party name"><TextInput autoFocus={!editing} placeholder="e.g. ABC Bakers" value={pName} onChange={(e) => setPName(e.target.value)} /></Field>
          <Field label="Type">
            <Segmented value={pKind} onChange={(k) => { setPKind(k); if (!num(pOpening)) setPSide(k === "supplier" ? "cr" : "dr"); }} options={[
              { id: "customer", label: "Customer", sub: "buys from us" }, { id: "supplier", label: "Supplier", sub: "we buy from" },
            ]} />
          </Field>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label="Phone"><TextInput inputMode="tel" placeholder="Phone number" value={pPhone} onChange={(e) => setPPhone(e.target.value)} /></Field>
            <Field label="Credit days"><TextInput inputMode="numeric" placeholder="7" value={pDays} onChange={(e) => setPDays(e.target.value)} /></Field>
          </div>
          <Field label="Address"><TextInput placeholder="Address" value={pAddress} onChange={(e) => setPAddress(e.target.value)} /></Field>
          <Field label="Opening balance ₹" hint={editParty ? `Current balance ${balText(editParty.currentBalance || 0)}` : undefined}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TextInput inputMode="decimal" placeholder="0" value={pOpening} onChange={(e) => setPOpening(e.target.value)} />
              <Segmented value={pSide} onChange={setPSide} options={[
                { id: "dr", label: "Dr · lena", sub: "they owe us" }, { id: "cr", label: "Cr · dena", sub: "we owe them" },
              ]} />
            </div>
          </Field>
          {editing && <p className="text-xs text-muted">Changing the opening balance moves the current balance by the same difference.</p>}
        </FormShell>
      )}
      {tab === "parties" && (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Card className="px-3 py-2"><p className="text-xs text-muted">To receive</p><p className="font-semibold tabular-nums">{formatINR(receivable)}</p></Card>
            <Card className="px-3 py-2"><p className="text-xs text-muted">To pay</p><p className="font-semibold tabular-nums">{formatINR(payable)}</p></Card>
          </div>
          <TextInput placeholder="Search party by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Segmented value={kindFilter} onChange={setKindFilter} options={[
            { id: "all", label: "All" }, { id: "customer", label: "Customers" }, { id: "supplier", label: "Suppliers" },
          ]} />
          <Card className="overflow-hidden p-0">
            {shownParties.length === 0 && <p className="p-4 text-sm text-muted">{parties.length ? "No party matches." : "No parties yet. Tap + New party."}</p>}
            {shownParties.map((p) => (
              <Row key={p.id} title={p.name} sub={[p.kind === "customer" ? "Customer" : "Supplier", p.phone].filter(Boolean).join(" · ")}
                right={balText(p.currentBalance || 0)} active={p.id === editing} onClick={() => openParty(p)} />
            ))}
          </Card>
        </>
      )}

      {/* ---------------- ITEMS ---------------- */}
      {tab === "items" && editing !== null && (
        <FormShell title={editing ? "Edit item" : "New item"} error={error} busy={busy} onSave={saveI} onCancel={close} onDelete={editing ? delI : undefined}>
          <Field label="Item name"><TextInput autoFocus={!editing} placeholder="e.g. Steam Coal" value={iName} onChange={(e) => setIName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Selling rate ₹/kg"><TextInput inputMode="decimal" placeholder="0" value={iRate} onChange={(e) => setIRate(e.target.value)} /></Field>
            <Field label="Opening stock kg" hint={editing ? `Now ${formatKg(stockOf(editing))}` : undefined}><TextInput inputMode="decimal" placeholder="0" value={iOpening} onChange={(e) => setIOpening(e.target.value)} /></Field>
          </div>
          {editing && <p className="text-xs text-muted">Changing the opening stock moves the current stock by the same difference.</p>}
        </FormShell>
      )}
      {tab === "items" && (
        <Card className="overflow-hidden p-0">
          {items.length === 0 && <p className="p-4 text-sm text-muted">No items yet. Tap + New item.</p>}
          {items.map((i) => {
            const kg = stockOf(i.id);
            return <Row key={i.id} title={i.name} sub={`Rate ₹${i.baseRate || 0}/kg · Opening ${formatKg(i.openingStock || 0)}`}
              right={formatKg(kg)} rightSub={kg < 0 ? "negative" : kg <= 500 ? "low stock" : "in stock"} active={i.id === editing} onClick={() => openItem(i)} />;
          })}
        </Card>
      )}

      {/* ---------------- ACCOUNTS ---------------- */}
      {tab === "accounts" && editing !== null && (
        <FormShell title={editing ? "Edit account" : "New account"} error={error} busy={busy} onSave={saveA} onCancel={close} onDelete={editing ? delA : undefined}>
          <Field label="Account name"><TextInput autoFocus={!editing} placeholder="e.g. Cash, HDFC Bank" value={aName} onChange={(e) => setAName(e.target.value)} /></Field>
          <Field label="Type">
            <Segmented value={aType} onChange={setAType} options={[{ id: "cash", label: "Cash", sub: "galla / in hand" }, { id: "bank", label: "Bank" }]} />
          </Field>
          <Field label="Opening balance ₹" hint={editAccount ? `Current balance ${formatINR(editAccount.balance || 0)}` : undefined}>
            <TextInput inputMode="decimal" placeholder="0" value={aOpening} onChange={(e) => setAOpening(e.target.value)} />
          </Field>
          {editing && <p className="text-xs text-muted">Changing the opening balance moves the current balance by the same difference.</p>}
        </FormShell>
      )}
      {tab === "accounts" && (
        <Card className="overflow-hidden p-0">
          {accounts.length === 0 && <p className="p-4 text-sm text-muted">No accounts yet. Tap + New account.</p>}
          {accounts.map((a) => (
            <Row key={a.id} title={a.name} sub={`${a.type === "cash" ? "Cash" : "Bank"} · Opening ${formatINR(a.openingBalance || 0)}`}
              right={formatINR(a.balance || 0)} active={a.id === editing} onClick={() => openAccount(a)} />
          ))}
        </Card>
      )}
    </div>
  );
}
