import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Label, NativeSelect, TextInput, TextArea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dashboard, factoryReset, listAccounts, listParties, listItems, saveBill, saveMoney, saveItem, saveParty, saveAccount, cancelBill, deleteAccount, deleteParty, deleteItem, savePurchase, clearCheque, saveSecurityPin } from "@/lib/store";
import { type Account, type BillLine, type Party, type Item, type Bill, type MoneyEntry } from "@/lib/types";
import { formatINR, formatKg, todayISO } from "@/lib/utils";

const n = (x: string) => Number(x) || 0;

const formatPartyBal = (bal: number) => {
  if (!bal) return formatINR(0);
  return bal > 0 ? `${formatINR(bal)} Dr` : `${formatINR(Math.abs(bal))} Cr`;
};

export function Today() {
  const { user } = useAuth();
  const [d, setD] = useState<Awaited<ReturnType<typeof dashboard>> | null>(null);
  
  const [qlType, setQlType] = useState<"payment_in" | "payment_out" | "expense">("payment_in");
  const [qlParty, setQlParty] = useState("");
  const [qlAccount, setQlAccount] = useState("");
  const [qlAmount, setQlAmount] = useState("");
  const [qlNotes, setQlNotes] = useState("");

  const [editPendingId, setEditPendingId] = useState<string | null>(null);
  const [editLines, setEditLines] = useState<BillLine[]>([]);
  const [chequeBank, setChequeBank] = useState("");

  const refresh = () => { if (user) dashboard(user.uid).then(setD); };
  useEffect(() => { refresh(); }, [user]);

  if (!d) return <p className="p-4">Loading workspace…</p>;

  const totalReceivables = d.parties.reduce((s, p) => s + (p.currentBalance > 0 ? p.currentBalance : 0), 0);
  const totalPayables = d.parties.reduce((s, p) => s + (p.currentBalance < 0 ? Math.abs(p.currentBalance) : 0), 0);
  const pendingDeliveries = d.bills.filter((b) => b.deliveryStatus === "scheduled");

  const handleQuickLedger = async () => {
    if (!user || !qlAccount || !n(qlAmount)) return;
    if (qlType !== "expense" && !qlParty) return alert("Select a party for payments.");
    
    await saveMoney(user.uid, {
      date: todayISO(),
      type: qlType,
      partyId: qlParty || null,
      partyName: qlParty ? d.parties.find(p => p.id === qlParty)?.name : "",
      accountId: qlAccount,
      amount: n(qlAmount),
      notes: qlNotes || "Quick posting"
    });
    setQlAmount(""); setQlNotes(""); setQlParty(""); setQlAccount("");
    refresh();
  };

  const handleMarkDelivered = async (b: Bill) => {
    if (!user) return;
    await saveBill(user.uid, { ...b, deliveryStatus: "delivered" }, b.id);
    refresh();
  };

  const handleSaveEdit = async (b: Bill) => {
    if (!user) return;
    const newTotal = editLines.reduce((s, l) => s + l.amount, 0) + b.deliveryCharge;
    await saveBill(user.uid, { ...b, lines: editLines, total: newTotal }, b.id);
    setEditPendingId(null);
    refresh();
  };

  const handleCancelBill = async (b: Bill) => {
    if (!user || !b.id || !confirm("Cancel this scheduled order?")) return;
    await cancelBill(user.uid, b.id);
    refresh();
  };

  const handleClearCheque = async (m: MoneyEntry) => {
    if (!user || !chequeBank) return alert("Please select a bank account to deposit the cheque.");
    await clearCheque(user.uid, m, chequeBank);
    setChequeBank("");
    refresh();
  };

  return (
    <div className="space-y-6 pb-12">
      <header>
        <h1 className="font-display text-3xl">Business Health</h1>
        <p className="text-muted">Live insights and ledger snapshot.</p>
      </header>

      <Card className="border-l-4 border-l-amber-500 bg-amber-50/20">
        <h2 className="font-display text-lg font-semibold text-amber-900">Priority Insights</h2>
        <div className="mt-3 space-y-2 text-sm">
          {d.pendingCheques.map(m => (
            <div key={m.id} className="p-2 bg-white rounded border border-amber-200 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
              <span className="text-amber-900 font-medium">🏛️ Present Cheque #{m.chequeNumber} from {m.partyName} ({formatINR(m.amount)})</span>
              <div className="flex gap-2">
                <NativeSelect className="h-9 min-w-0 flex-1 text-sm sm:w-36 sm:flex-none" value={chequeBank} onChange={e => setChequeBank(e.target.value)}>
                  <option value="">Select Bank</option>
                  {d.accounts.filter(a => a.type === "bank").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </NativeSelect>
                <Button size="sm" onClick={() => handleClearCheque(m)}>Mark Cleared</Button>
              </div>
            </div>
          ))}
          {d.overdueParties.length > 0 ? (
            d.overdueParties.map(({ party, overdueAmount, daysOverdue }) => (
              <p key={party.id} className="text-red-700">⚠️ <b>{party.name}</b>: {formatINR(overdueAmount)} overdue ({daysOverdue} days)</p>
            ))
          ) : <p className="text-emerald-700">✅ No payments are overdue.</p>}
          {d.stockInsights.filter((s) => s.status === "low_stock").map((s) => (
            <p key={s.itemId} className="text-orange-700">📦 Low Stock: <b>{s.itemName}</b> ({formatKg(s.currentKg)} left).</p>
          ))}
          {d.stockInsights.filter((s) => s.status === "dead_stock").map((s) => (
            <p key={s.itemId} className="text-muted">⏳ Dead Stock: <b>{s.itemName}</b> has zero sales in 30 days.</p>
          ))}
        </div>
      </Card>

      <div className="grid md:grid-cols-1 gap-4">
        <Card className="bg-surface border-border flex flex-col justify-between">
          <div>
            <h2 className="font-display text-lg mb-3">Quick Ledger Posting</h2>
            <div className="grid grid-cols-2 gap-2">
              <NativeSelect value={qlType} onChange={e => setQlType(e.target.value as any)}>
                <option value="payment_in">Payment In (+)</option>
                <option value="payment_out">Payment Out (-)</option>
                <option value="expense">Expense (-)</option>
              </NativeSelect>
              <NativeSelect value={qlAccount} onChange={e => setQlAccount(e.target.value)}>
                <option value="">Select Account</option>
                {d.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {qlType !== "expense" ? (
                <NativeSelect value={qlParty} onChange={e => setQlParty(e.target.value)}>
                  <option value="">-- Select Party --</option>
                  <optgroup label="Customers (Dr)">
                    {d.parties.filter(p => p.kind === "customer").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                  <optgroup label="Suppliers (Cr)">
                    {d.parties.filter(p => p.kind === "supplier").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                </NativeSelect>
              ) : (
                <TextInput placeholder="Expense Reason" value={qlNotes} onChange={e => setQlNotes(e.target.value)} />
              )}
              <TextInput placeholder="Amount" inputMode="decimal" value={qlAmount} onChange={e => setQlAmount(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex justify-end border-t pt-3">
            <Button className="h-10" onClick={handleQuickLedger}>Post to Ledger</Button>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="font-display text-xl mb-3">Delivery Schedule Window</h2>
        {pendingDeliveries.length === 0 && <p className="text-muted text-sm">No scheduled deliveries pending.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pendingDeliveries.map(b => (
            <Card key={b.id} className="flex flex-col justify-between shadow-sm">
              {editPendingId === b.id ? (
                <div className="space-y-2">
                  <p className="font-medium text-sm border-b pb-2 mb-2">Editing {b.customerName}'s Order</p>
                  {editLines.map((l, idx) => (
                    <div key={idx} className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-sm truncate font-medium">{l.itemName}</span>
                      <TextInput placeholder="Kg" inputMode="decimal" value={l.kg} onChange={e => {
                        const nl = [...editLines]; nl[idx].kg = n(e.target.value); nl[idx].amount = nl[idx].kg * nl[idx].rate; setEditLines(nl);
                      }} />
                      <TextInput placeholder="Rate" inputMode="decimal" value={l.rate} onChange={e => {
                        const nl = [...editLines]; nl[idx].rate = n(e.target.value); nl[idx].amount = nl[idx].kg * nl[idx].rate; setEditLines(nl);
                      }} />
                    </div>
                  ))}
                  <div className="flex gap-2 mt-4">
                    <Button className="w-full" size="sm" onClick={() => handleSaveEdit(b)}>Save</Button>
                    <Button className="w-full" size="sm" variant="outline" onClick={() => setEditPendingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-lg leading-tight">{b.customerName}</h3>
                      <span className="text-[10px] uppercase tracking-wider bg-surface border px-2 py-0.5 rounded-full text-muted">{b.saleType === 'prepaid_delivery' ? 'Prepaid' : 'Credit'}</span>
                    </div>
                    <p className="text-sm text-primary font-medium mb-3">Deliver: {b.deliveryDate} @ {b.deliveryTime}</p>
                    <div className="bg-bg rounded p-2 mb-3 space-y-1">
                      {b.lines.map((l, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-muted">{l.itemName} ({l.kg}kg)</span>
                          <span>{formatINR(l.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-sm text-muted">Total</span>
                      <span className="font-bold text-lg">{formatINR(b.total)}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1" size="sm" onClick={() => handleMarkDelivered(b)}>Deliver</Button>
                      <Button size="sm" variant="outline" onClick={() => { setEditPendingId(b.id!); setEditLines(b.lines); }}>Edit</Button>
                      <Button size="sm" variant="outline" className="text-danger border-danger/30 hover:bg-danger/10" onClick={() => handleCancelBill(b)}>Cancel</Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <h2 className="font-display text-xl mb-3">Godown Stock</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {d.stockInsights.map((s) => (
            <div key={s.itemId} className="rounded border bg-surface p-3">
              <p className="text-sm text-muted mb-1">{s.itemName}</p>
              <b className="text-2xl font-display">{formatKg(s.currentKg)}</b>
            </div>
          ))}
          {d.stockInsights.length === 0 && <p className="text-sm text-muted col-span-full">Add items in settings first.</p>}
        </div>
      </Card>

      <div>
        <h2 className="font-display text-xl mb-3">Accounts & Receivables</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {d.accounts.map((acc) => (
            <Stat key={acc.id} a={acc.name} b={formatINR(acc.balance || 0)} />
          ))}
          <Card className="bg-primary text-primary-fg">
            <p className="text-xs text-primary-fg/80">Total Receivables</p>
            <p className="mt-1 text-xl font-semibold">{formatINR(totalReceivables)}</p>
          </Card>
          <Card className="bg-danger text-danger-fg">
            <p className="text-xs text-danger-fg/80">Total Payables</p>
            <p className="mt-1 text-xl font-semibold">{formatINR(totalPayables)}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ a, b }: { a: string; b: string }) {
  return (
    <Card>
      <p className="text-xs text-muted truncate">{a}</p>
      <p className="mt-1 text-xl font-semibold">{b}</p>
    </Card>
  );
}

export { BillPage, PurchasePage, MoneyPage } from "./entry";
export { Reports } from "./reports";
export { Masters } from "./masters";

export function Settings() {
  const { user } = useAuth();
  const [typed, setTyped] = useState("");
  const [newPin, setNewPin] = useState("");

  const handleUpdatePin = async () => {
    if (!user || newPin.length < 4) return alert("PIN must be at least 4 digits");
    await saveSecurityPin(user.uid, newPin);
    setNewPin("");
    alert("Security M-PIN updated successfully.");
  };

  return (
    <div className="space-y-4 pb-12">
      <h1 className="font-display text-3xl">Settings</h1>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Parties, items and accounts</h2>
          <p className="text-sm text-muted mt-1">These have moved to the Masters page.</p>
        </div>
        <Link to="/masters" className="inline-flex h-11 items-center rounded-[var(--radius-sm)] bg-primary px-4 font-medium text-primary-fg">Open Masters</Link>
      </Card>

      <Card>
        <h2 className="font-medium">Security Details</h2>
        <p className="text-sm text-muted mt-1">Change your 4-digit M-PIN. This locks the app when you close the tab.</p>
        <div className="flex gap-2 mt-3">
           <TextInput type="password" inputMode="numeric" pattern="[0-9]*" placeholder="New M-PIN" value={newPin} onChange={e => setNewPin(e.target.value)} />
           <Button className="shrink-0 whitespace-nowrap" onClick={handleUpdatePin}>Update PIN</Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-medium text-danger">Factory reset test data</h2>
        <Label className="mt-2">Type RESET to enable</Label>
        <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button variant="outline" className="mt-3" disabled={typed !== "RESET"} onClick={async () => {
          if (user && confirm("Permanently delete all test data?")) {
            await factoryReset(user.uid);
            location.href = "/";
          }
        }}>Factory reset</Button>
      </Card>
    </div>
  );
}
