import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Label, NativeSelect, TextInput, TextArea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dashboard, factoryReset, listAccounts, listParties, listItems, saveBill, saveMoney, saveItem, saveParty, saveAccount, cancelBill, deleteAccount, deleteParty, deleteItem, savePurchase, clearCheque, saveSecurityPin, revertMoney, revertPurchase, revertBill } from "@/lib/store";
import { type Account, type BillLine, type Party, type Item, type SaleType, type Bill, type MoneyEntry, type Purchase } from "@/lib/types";
import { formatINR, formatKg, todayISO } from "@/lib/utils";

const n = (x: string) => Number(x) || 0;
const getYesterdayISO = () => new Date(Date.now() - 86400000).toISOString().split("T")[0];

const formatPartyBal = (bal: number) => {
  if (!bal) return formatINR(0);
  return bal > 0 ? `${formatINR(bal)} Dr` : `${formatINR(Math.abs(bal))} Cr`;
};

// Gate Pass Printer Helper
const printGatePass = (data: { date: string; customerName: string; saleType: string; lines: BillLine[]; deliveryCharge: number; total: number }) => {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`
    <html>
      <head>
        <title>Gate Pass - United Coal Depot</title>
        <style>
          body { font-family: monospace; padding: 20px; color: #000; }
          h2, h4 { margin: 0 0 5px 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th, td { border-bottom: 1px dashed #000; padding: 6px; text-align: left; font-size: 14px; }
          .text-right { text-align: right; }
          .mt { margin-top: 15px; }
        </style>
      </head>
      <body>
        <h2>UNITED COAL DEPOT</h2>
        <h4>GATE PASS / DELIVERY SLIP</h4>
        <div class="mt">
          <p><strong>Date:</strong> ${data.date}</p>
          <p><strong>Customer / Party:</strong> ${data.customerName || "Walk-in"}</p>
          <p><strong>Sale Type:</strong> ${data.saleType.toUpperCase()}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th class="text-right">Qty (Kg)</th>
              <th class="text-right">Rate</th>
              <th class="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${data.lines.map(l => `
              <tr>
                <td>${l.itemName}</td>
                <td class="text-right">${l.kg}</td>
                <td class="text-right">₹${l.rate}</td>
                <td class="text-right">₹${l.amount}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${data.deliveryCharge ? `<p class="mt">Delivery Charge: ₹${data.deliveryCharge}</p>` : ''}
        <h3 class="mt">Grand Total: ₹${data.total}</h3>
        <script>window.print();</script>
      </body>
    </html>
  `);
  win.document.close();
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
            <div key={m.id} className="p-2 bg-white rounded border border-amber-200 flex justify-between items-center">
              <span className="text-amber-900 font-medium">🏛️ Present Cheque #{m.chequeNumber} from {m.partyName} ({formatINR(m.amount)})</span>
              <div className="flex gap-2">
                <NativeSelect className="w-32 text-xs" value={chequeBank} onChange={e => setChequeBank(e.target.value)}>
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

export function BillPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Card 1 State: Walk-in (Cash Sale)
  const [wItem, setWItem] = useState("");
  const [wKg, setWKg] = useState("");
  const [wRate, setWRate] = useState("");
  const [wAccount, setWAccount] = useState("");
  const [wDate, setWDate] = useState(todayISO());

  // Card 2 State: Restaurant Credit Delivery
  const [cParty, setCParty] = useState("");
  const [cSelItem, setCSelItem] = useState("");
  const [cKg, setCKg] = useState("");
  const [cRate, setCRate] = useState("");
  const [cLines, setCLines] = useState<BillLine[]>([]);
  const [cDelivery, setCDelivery] = useState("");
  const [cWhen, setCWhen] = useState(todayISO());
  const [cTime, setCTime] = useState("");
  const [cDate, setCDate] = useState(todayISO());

  // Card 3 State: Scheduled Prepaid Delivery
  const [pParty, setPParty] = useState("");
  const [pName, setPName] = useState("");
  const [pPhone, setPPhone] = useState("");
  const [pAddress, setPAddress] = useState("");
  const [pSelItem, setPSelItem] = useState("");
  const [pKg, setPKg] = useState("");
  const [pRate, setPRate] = useState("");
  const [pLines, setPLines] = useState<BillLine[]>([]);
  const [pDelivery, setPDelivery] = useState("");
  const [pAccount, setPAccount] = useState("");
  const [pWhen, setPWhen] = useState(todayISO());
  const [pTime, setPTime] = useState("");
  const [pDate, setPDate] = useState(todayISO());

  useEffect(() => {
    if (user) {
      listParties(user.uid).then(setParties);
      listAccounts(user.uid).then((a) => { 
        setAccounts(a); 
        if (a[0]) { setWAccount(a[0].id); setPAccount(a[0].id); }
      });
      listItems(user.uid).then((res) => { 
        setItems(res); 
        if (res.length > 0) { 
          setWItem(res[0].id); setWRate(String(res[0].baseRate));
          setCSelItem(res[0].id); setCRate(String(res[0].baseRate));
          setPSelItem(res[0].id); setPRate(String(res[0].baseRate));
        } 
      });
    }
  }, [user]);

  // Auto rate updates
  useEffect(() => {
    if (wItem && items.length) {
      const it = items.find(i => i.id === wItem);
      if (it) setWRate(String(it.baseRate));
    }
  }, [wItem, items]);

  useEffect(() => {
    if (cSelItem && items.length) {
      const activeItem = items.find(i => i.id === cSelItem);
      const activeParty = parties.find(p => p.id === cParty);
      let newRate = activeItem?.baseRate || 0;
      if (activeParty && activeParty.customRates && activeParty.customRates[cSelItem]) newRate = activeParty.customRates[cSelItem];
      setCRate(newRate ? String(newRate) : "");
    }
  }, [cSelItem, cParty, items, parties]);

  useEffect(() => {
    if (pSelItem && items.length) {
      const it = items.find(i => i.id === pSelItem);
      if (it) setPRate(String(it.baseRate));
    }
  }, [pSelItem, items]);

  // Handlers for Save & Print Gate Pass
  const handleSaveWalkin = async (print: boolean) => {
    if (!user || !wItem || !wAccount || !n(wKg)) return;
    const it = items.find(i => i.id === wItem)!;
    const amt = n(wKg) * n(wRate);
    const lines = [{ itemId: it.id, itemName: it.name, kg: n(wKg), rate: n(wRate), amount: amt }];
    const total = amt;

    await saveBill(user.uid, {
      date: wDate,
      saleType: "walkin",
      partyId: null,
      customerName: "Walk-in",
      phone: "", address: "", deliveryDate: "", deliveryTime: "", deliveryCharge: 0,
      lines,
      total,
      accountId: wAccount,
      paymentMethod: "cash",
      deliveryStatus: null,
      isPosted: false,
      notes: "Quick Walkin Sale"
    });

    if (print) {
      printGatePass({ date: wDate, customerName: "Walk-in", saleType: "Walk-in Sale", lines, deliveryCharge: 0, total });
    }
    nav("/");
  };

  const handleSaveCredit = async (print: boolean) => {
    if (!user || !cParty || !cLines.length) return alert("Select party and add items.");
    const total = cLines.reduce((s, l) => s + l.amount, 0) + n(cDelivery);
    const customerObj = parties.find(p => p.id === cParty);

    await saveBill(user.uid, {
      date: cDate,
      saleType: "credit_delivery",
      partyId: cParty,
      customerName: customerObj?.name || "",
      phone: "", address: "",
      deliveryDate: cWhen,
      deliveryTime: cTime,
      deliveryCharge: n(cDelivery),
      lines: cLines,
      total,
      accountId: null,
      paymentMethod: "credit",
      deliveryStatus: "scheduled",
      isPosted: false,
      notes: ""
    });

    if (print) {
      printGatePass({ date: cDate, customerName: customerObj?.name || "Credit Customer", saleType: "Restaurant Credit Delivery", lines: cLines, deliveryCharge: n(cDelivery), total });
    }
    nav("/");
  };

  const handleSavePrepaid = async (print: boolean) => {
    if (!user || !pLines.length) return alert("Add items to bill.");
    if (!pParty && !pName) return alert("Choose or enter customer name.");
    const total = pLines.reduce((s, l) => s + l.amount, 0) + n(pDelivery);
    const custName = pParty ? (parties.find(p => p.id === pParty)?.name || "") : pName;

    await saveBill(user.uid, {
      date: pDate,
      saleType: "prepaid_delivery",
      partyId: pParty || null,
      customerName: custName,
      phone: pPhone,
      address: pAddress,
      deliveryDate: pWhen,
      deliveryTime: pTime,
      deliveryCharge: n(pDelivery),
      lines: pLines,
      total,
      accountId: pAccount,
      paymentMethod: "cash",
      deliveryStatus: "scheduled",
      isPosted: false,
      notes: ""
    });

    if (print) {
      printGatePass({ date: pDate, customerName: custName || "Prepaid Customer", saleType: "Prepaid Scheduled Delivery", lines: pLines, deliveryCharge: n(pDelivery), total });
    }
    nav("/");
  };

  return (
    <div className="space-y-6 pb-12">
      <h1 className="font-display text-3xl">Create Bill / Gate Pass</h1>

      {/* Grid changed to lg:grid-cols-3 to prevent desktop squishing */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* CARD 1: Walk-In / Cash Sale */}
        <Card className="bg-primary/5 border-primary/20 flex flex-col justify-between h-full">
          <div>
            <h2 className="font-display text-lg mb-4 border-b border-primary/20 pb-2">1. Walk-in · Paid Now</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs mb-1 block">Date</Label>
                  <TextInput type="date" value={wDate} onChange={e => setWDate(e.target.value)} max={todayISO()} />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Received Into</Label>
                  <NativeSelect value={wAccount} onChange={e => setWAccount(e.target.value)}>
                    <option value="">Select Account</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </NativeSelect>
                </div>
              </div>

              <div className="bg-white/50 dark:bg-black/10 p-3 rounded border border-primary/10">
                <Label className="text-xs mb-2 block font-semibold text-primary">Item Details</Label>
                <NativeSelect className="mb-3" value={wItem} onChange={e => setWItem(e.target.value)}>
                  <option value="">Select Item</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </NativeSelect>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] uppercase text-muted mb-1 block">Quantity</Label>
                    <TextInput placeholder="Kg" inputMode="decimal" value={wKg} onChange={e => setWKg(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-muted mb-1 block">Rate</Label>
                    <TextInput placeholder="₹ Rate" inputMode="decimal" value={wRate} onChange={e => setWRate(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-6 border-t border-primary/20 pt-4 space-y-4">
            <span className="font-semibold text-xl block text-primary">Total: {formatINR(n(wKg) * n(wRate))}</span>
            <div className="grid grid-cols-2 gap-2">
              <Button className="w-full text-xs" variant="outline" onClick={() => handleSaveWalkin(true)}>🖨️ Print Pass</Button>
              <Button className="w-full text-xs" onClick={() => handleSaveWalkin(false)}>💾 Save Only</Button>
            </div>
          </div>
        </Card>

        {/* CARD 2: Restaurant Credit Delivery */}
        <Card className="bg-surface border-border flex flex-col justify-between h-full">
          <div>
            <h2 className="font-display text-lg mb-4 border-b pb-2">2. Restaurant · Credit</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                 <div>
                    <Label className="text-xs mb-1 block">Date</Label>
                    <TextInput type="date" value={cDate} onChange={e => setCDate(e.target.value)} min={getYesterdayISO()} max={todayISO()} />
                 </div>
                 <div>
                    <Label className="text-xs mb-1 block">Party</Label>
                    <NativeSelect value={cParty} onChange={e => setCParty(e.target.value)}>
                      <option value="">Select Party</option>
                      {parties.filter(p => p.kind === "customer").map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </NativeSelect>
                 </div>
              </div>

              <div className="bg-black/5 dark:bg-white/5 p-3 rounded border border-border">
                  <Label className="text-xs mb-2 block font-semibold">Add Items</Label>
                  <NativeSelect className="mb-3" value={cSelItem} onChange={e => setCSelItem(e.target.value)}>
                    {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </NativeSelect>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <Label className="text-[10px] uppercase text-muted mb-1 block">Quantity</Label>
                      <TextInput placeholder="Kg" inputMode="decimal" value={cKg} onChange={e => setCKg(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase text-muted mb-1 block">Rate</Label>
                      <TextInput placeholder="₹ Rate" inputMode="decimal" value={cRate} onChange={e => setCRate(e.target.value)} />
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" className="w-full" onClick={() => {
                    if (n(cKg) > 0 && cSelItem) {
                      const it = items.find(i => i.id === cSelItem)!;
                      setCLines([...cLines, { itemId: it.id, itemName: it.name, kg: n(cKg), rate: n(cRate), amount: n(cKg) * n(cRate) }]);
                      setCKg("");
                    }
                  }}>+ Add to List</Button>
              </div>
              
              {cLines.length > 0 && (
                  <div className="bg-bg rounded p-2 max-h-24 overflow-y-auto text-xs space-y-1 border">
                    {cLines.map((l, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{l.itemName} ({l.kg}kg)</span>
                        <span className="font-medium">{formatINR(l.amount)}</span>
                      </div>
                    ))}
                  </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                 <div>
                    <Label className="text-xs mb-1 block">Del. Charge ₹</Label>
                    <TextInput placeholder="Charge" inputMode="decimal" value={cDelivery} onChange={e => setCDelivery(e.target.value)} />
                 </div>
                 <div>
                    <Label className="text-xs mb-1 block">Del. Date</Label>
                    <TextInput type="date" value={cWhen} onChange={e => setCWhen(e.target.value)} />
                 </div>
              </div>
              <div>
                 <Label className="text-xs mb-1 block">Del. Time</Label>
                 <TextInput type="time" value={cTime} onChange={e => setCTime(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="mt-6 border-t pt-4 space-y-4">
            <span className="font-semibold text-xl block">Total: {formatINR(cLines.reduce((s, l) => s + l.amount, 0) + n(cDelivery))}</span>
            <div className="grid grid-cols-2 gap-2">
              <Button className="w-full text-xs" variant="outline" onClick={() => handleSaveCredit(true)}>🖨️ Print Pass</Button>
              <Button className="w-full text-xs" onClick={() => handleSaveCredit(false)}>💾 Save Only</Button>
            </div>
          </div>
        </Card>

        {/* CARD 3: Scheduled Delivery · Paid in Advance */}
        <Card className="bg-surface border-border flex flex-col justify-between h-full">
          <div>
            <h2 className="font-display text-lg mb-4 border-b pb-2">3. Scheduled · Prepaid</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                 <div>
                    <Label className="text-xs mb-1 block">Date</Label>
                    <TextInput type="date" value={pDate} onChange={e => setPDate(e.target.value)} min={getYesterdayISO()} max={todayISO()} />
                 </div>
                 <div>
                    <Label className="text-xs mb-1 block">Customer</Label>
                    <NativeSelect value={pParty} onChange={e => setPParty(e.target.value)}>
                      <option value="">One-off / New</option>
                      {parties.filter(p => p.kind === "customer").map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </NativeSelect>
                 </div>
              </div>
              
              {!pParty && (
                <div className="grid grid-cols-2 gap-2">
                    <TextInput placeholder="Name" value={pName} onChange={e => setPName(e.target.value)} />
                    <TextInput placeholder="Phone" inputMode="tel" value={pPhone} onChange={e => setPPhone(e.target.value)} />
                    <div className="col-span-2">
                      <TextArea placeholder="Full Delivery Address" value={pAddress} onChange={e => setPAddress(e.target.value)} />
                    </div>
                </div>
              )}

              <div className="bg-black/5 dark:bg-white/5 p-3 rounded border border-border">
                  <Label className="text-xs mb-2 block font-semibold">Add Items</Label>
                  <NativeSelect className="mb-3" value={pSelItem} onChange={e => setPSelItem(e.target.value)}>
                    {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </NativeSelect>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <Label className="text-[10px] uppercase text-muted mb-1 block">Quantity</Label>
                      <TextInput placeholder="Kg" inputMode="decimal" value={pKg} onChange={e => setPKg(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase text-muted mb-1 block">Rate</Label>
                      <TextInput placeholder="₹ Rate" inputMode="decimal" value={pRate} onChange={e => setPRate(e.target.value)} />
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" className="w-full" onClick={() => {
                    if (n(pKg) > 0 && pSelItem) {
                      const it = items.find(i => i.id === pSelItem)!;
                      setPLines([...pLines, { itemId: it.id, itemName: it.name, kg: n(pKg), rate: n(pRate), amount: n(pKg) * n(pRate) }]);
                      setPKg("");
                    }
                  }}>+ Add to List</Button>
              </div>

              {pLines.length > 0 && (
                  <div className="bg-bg rounded p-2 max-h-24 overflow-y-auto text-xs space-y-1 border">
                    {pLines.map((l, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{l.itemName} ({l.kg}kg)</span>
                        <span className="font-medium">{formatINR(l.amount)}</span>
                      </div>
                    ))}
                  </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                 <div>
                   <Label className="text-xs mb-1 block">Received Into</Label>
                   <NativeSelect value={pAccount} onChange={e => setPAccount(e.target.value)}>
                      <option value="">Account</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                   </NativeSelect>
                 </div>
                 <div>
                   <Label className="text-xs mb-1 block">Del. Charge ₹</Label>
                   <TextInput placeholder="Charge" inputMode="decimal" value={pDelivery} onChange={e => setPDelivery(e.target.value)} />
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                 <div>
                    <Label className="text-xs mb-1 block">Del. Date</Label>
                    <TextInput type="date" value={pWhen} onChange={e => setPWhen(e.target.value)} />
                 </div>
                 <div>
                    <Label className="text-xs mb-1 block">Del. Time</Label>
                    <TextInput type="time" value={pTime} onChange={e => setPTime(e.target.value)} />
                 </div>
              </div>

            </div>
          </div>
          <div className="mt-6 border-t pt-4 space-y-4">
            <span className="font-semibold text-xl block">Total: {formatINR(pLines.reduce((s, l) => s + l.amount, 0) + n(pDelivery))}</span>
            <div className="grid grid-cols-2 gap-2">
              <Button className="w-full text-xs" variant="outline" onClick={() => handleSavePrepaid(true)}>🖨️ Print Pass</Button>
              <Button className="w-full text-xs" onClick={() => handleSavePrepaid(false)}>💾 Save Only</Button>
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
}

export function PurchasePage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<"cash" | "credit">("credit");
  const [party, setParty] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [selItem, setSelItem] = useState("");
  const [kg, setKg] = useState("");
  const [rate, setRate] = useState("");
  const [account, setAccount] = useState("");

  useEffect(() => {
    if (user) {
      listParties(user.uid).then(setParties);
      listAccounts(user.uid).then((a) => { setAccounts(a); setAccount(a[0]?.id || ""); });
      listItems(user.uid).then((res) => { setItems(res); if (res.length > 0) setSelItem(res[0].id); });
    }
  }, [user]);

  const total = n(kg) * n(rate);

  async function save() {
    if (!user || !selItem || total <= 0) return;
    if (type === "credit" && !party) return alert("Select an existing supplier for credit purchases.");
    
    const it = items.find(i => i.id === selItem)!;
    await savePurchase(user.uid, {
      date,
      partyId: party || "",
      supplierName: party ? (parties.find(p => p.id === party)?.name || "") : supplierName,
      itemId: it.id,
      itemName: it.name,
      kg: n(kg),
      rate: n(rate),
      total,
      accountId: type === "cash" ? account : null,
      paymentMethod: type
    });
    nav("/");
  }

  return (
    <div className="space-y-4 pb-12">
      <h1 className="font-display text-3xl">Add Stock</h1>
      <TextInput type="date" value={date} onChange={e => setDate(e.target.value)} max={todayISO()} />
      <NativeSelect value={type} onChange={e => setType(e.target.value as "cash"|"credit")}>
        <option value="credit">Credit Purchase</option>
        <option value="cash">Cash Purchase</option>
      </NativeSelect>
      {type === "credit" ? (
        <NativeSelect value={party} onChange={e => setParty(e.target.value)}>
          <option value="">-- Select Supplier --</option>
          {parties.filter(p => p.kind === "supplier").map(p => (
            <option key={p.id} value={p.id}>{p.name} (Bal: {formatPartyBal(p.currentBalance)})</option>
          ))}
        </NativeSelect>
      ) : (
        <>
          <NativeSelect value={account} onChange={e => setAccount(e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </NativeSelect>
          <TextInput placeholder="Supplier Name (Optional)" value={supplierName} onChange={e => setSupplierName(e.target.value)} />
        </>
      )}

      <Card>
        <h2 className="font-medium">Item Details</h2>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <NativeSelect value={selItem} onChange={e => setSelItem(e.target.value)}>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </NativeSelect>
          <div className="grid grid-cols-2 gap-2">
            <TextInput placeholder="Total Kg" inputMode="decimal" value={kg} onChange={e => setKg(e.target.value)} />
            <TextInput placeholder="Cost Rate" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />
          </div>
        </div>
      </Card>
      <p className="text-lg font-semibold">Total Cost {formatINR(total)}</p>
      <Button className="w-full h-12 text-base font-medium" onClick={save}>Save Purchase</Button>
    </div>
  );
}

export function MoneyPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [parties, setParties] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<"payment_in" | "payment_out" | "expense" | "pdc_in">("payment_in");
  const [party, setParty] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [clearanceDate, setClearanceDate] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");

  useEffect(() => {
    if (user) {
      listParties(user.uid).then(setParties);
      listAccounts(user.uid).then(a => { setAccounts(a); setAccount(a[0]?.id || ""); });
    }
  }, [user]);

  async function save() {
    if (!user || n(amount) <= 0) return;
    if (type !== "pdc_in" && !account) return alert("Select an account.");
    if (type !== "expense" && !party) return alert("Select a party.");

    await saveMoney(user.uid, {
      date,
      type,
      status: type === "pdc_in" ? "pending" : undefined,
      clearanceDate: type === "pdc_in" ? clearanceDate : undefined,
      chequeNumber: type === "pdc_in" ? chequeNumber : undefined,
      partyId: party || null,
      partyName: party ? parties.find(p => p.id === party)?.name : "",
      accountId: type === "pdc_in" ? null : account,
      amount: n(amount),
      notes
    });
    nav("/");
  }

  return (
    <div className="space-y-4 pb-12">
      <h1 className="font-display text-3xl">Ledger Entry</h1>
      <TextInput type="date" value={date} onChange={e => setDate(e.target.value)} max={todayISO()} />
      <NativeSelect value={type} onChange={e => setType(e.target.value as any)}>
        <option value="payment_in">Payment In (Received)</option>
        <option value="pdc_in">Post-dated Cheque (PDC Received)</option>
        <option value="payment_out">Payment Out (Sent)</option>
        <option value="expense">General Expense</option>
      </NativeSelect>

      {type === "pdc_in" ? (
        <Card className="bg-amber-50">
          <h2 className="text-sm font-medium mb-2">Cheque Details</h2>
          <div className="grid grid-cols-2 gap-2">
            <TextInput type="date" placeholder="Clearance Date" value={clearanceDate} onChange={e => setClearanceDate(e.target.value)} />
            <TextInput placeholder="Cheque Number" value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} />
          </div>
        </Card>
      ) : (
        <NativeSelect value={account} onChange={e => setAccount(e.target.value)}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </NativeSelect>
      )}

      {type !== "expense" && (
        <NativeSelect value={party} onChange={e => setParty(e.target.value)}>
          <option value="">-- Select Party --</option>
          <optgroup label="Customers (Dr)">
             {parties.filter(p => p.kind === "customer").map(p => <option key={p.id} value={p.id}>{p.name} (Bal: {formatPartyBal(p.currentBalance)})</option>)}
          </optgroup>
          <optgroup label="Suppliers (Cr)">
             {parties.filter(p => p.kind === "supplier").map(p => <option key={p.id} value={p.id}>{p.name} (Bal: {formatPartyBal(p.currentBalance)})</option>)}
          </optgroup>
        </NativeSelect>
      )}

      <TextInput placeholder="Amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
      <TextArea placeholder="Notes / Description" value={notes} onChange={e => setNotes(e.target.value)} />
      <Button className="w-full h-12 text-base font-medium" onClick={save}>Save Entry</Button>
    </div>
  );
}

function downloadCSV(data: any[][], filename: string) {
  const csv = data.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
}

export function Reports() {
  const { user } = useAuth();
  const [d, setD] = useState<Awaited<ReturnType<typeof dashboard>> | null>(null);
  const [tab, setTab] = useState<"ledger"|"stock"|"debtors"|"sales"|"purchases">("ledger");
  
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0]; });
  const [toDate, setToDate] = useState(todayISO());
  const [partyId, setPartyId] = useState("");

  const [editMoney, setEditMoney] = useState<MoneyEntry | null>(null);
  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editKg, setEditKg] = useState("");
  const [editRate, setEditRate] = useState("");

  const refresh = () => { if (user) dashboard(user.uid).then(setD); };
  useEffect(() => { refresh(); }, [user]);

  if (!d) return <p className="p-4">Loading reports…</p>;

  const handleUpdateMoney = async () => {
    if (!user || !editMoney) return;
    await revertMoney(user.uid, editMoney.id!);
    await saveMoney(user.uid, { ...editMoney, amount: n(editAmount), date: editDate, notes: editNotes }, editMoney.id);
    setEditMoney(null);
    refresh();
  };

  const handleUpdatePurchase = async () => {
    if (!user || !editPurchase) return;
    await revertPurchase(user.uid, editPurchase.id!);
    await savePurchase(user.uid, { ...editPurchase, kg: n(editKg), rate: n(editRate), total: n(editKg) * n(editRate), date: editDate }, editPurchase.id);
    setEditPurchase(null);
    refresh();
  };

  const handleDeleteBill = async (b: Bill) => {
    if (!user || !b.id || !confirm("Permanently delete this bill? This will reverse stock and ledger balances.")) return;
    await revertBill(user.uid, b.id);
    refresh();
  };

  let ledgerEntries: any[] = [];
  let selectedParty: Party | undefined;
  let runningBal = 0;

  if (partyId) {
    selectedParty = d.parties.find(p => p.id === partyId);
    runningBal = selectedParty?.openingBalance || 0; 

    d.bills.filter(b => b.partyId === partyId && b.isPosted && b.date < fromDate).forEach(b => runningBal += b.total);
    d.purchases.filter(p => p.partyId === partyId && p.date < fromDate).forEach(p => runningBal -= p.total);
    d.money.filter(m => m.partyId === partyId && m.date < fromDate).forEach(m => {
      if (m.type === "payment_in" || m.status === "cleared") runningBal -= m.amount;
      else if (m.type === "payment_out") runningBal += m.amount;
    });

    d.bills.filter(b => b.partyId === partyId && b.isPosted && b.date >= fromDate && b.date <= toDate).forEach(b => {
      ledgerEntries.push({ date: b.date, desc: `Bill`, debit: b.total, credit: 0, sort: new Date(b.date).getTime(), source: b });
    });
    d.purchases.filter(p => p.partyId === partyId && p.date >= fromDate && p.date <= toDate).forEach(p => {
      ledgerEntries.push({ date: p.date, desc: `Purchase (${p.itemName})`, debit: 0, credit: p.total, sort: new Date(p.date).getTime(), source: p });
    });
    d.money.filter(m => m.partyId === partyId && m.date >= fromDate && m.date <= toDate).forEach(m => {
      if (m.type === "payment_in" || m.status === "cleared") ledgerEntries.push({ date: m.date, desc: `Payment In: ${m.notes}`, debit: 0, credit: m.amount, sort: new Date(m.date).getTime(), source: m });
      else if (m.type === "payment_out") ledgerEntries.push({ date: m.date, desc: `Payment Out: ${m.notes}`, debit: m.amount, credit: 0, sort: new Date(m.date).getTime(), source: m });
    });
    ledgerEntries.sort((a, b) => a.sort - b.sort);
  }

  const sales = d.bills.filter(b => b.isPosted && b.date >= fromDate && b.date <= toDate);
  const purchases = d.purchases.filter(p => p.date >= fromDate && p.date <= toDate);
  const debtors = d.parties.filter(p => p.currentBalance !== 0).sort((a, b) => b.currentBalance - a.currentBalance);

  return (
    <div className="space-y-4 pb-12">
      <h1 className="font-display text-3xl">Reports</h1>
      <Card className="flex flex-col md:flex-row gap-2">
        <NativeSelect value={tab} onChange={e => setTab(e.target.value as any)}>
          <option value="ledger">Party Ledger</option>
          <option value="sales">Daily Sales</option>
          <option value="purchases">Purchases</option>
          <option value="stock">Stock Situation</option>
          <option value="debtors">Debtor / Creditor List</option>
        </NativeSelect>
        {tab !== "stock" && tab !== "debtors" && (
          <div className="flex gap-2">
            <TextInput type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <TextInput type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
        )}
      </Card>

      {editMoney && (
        <Card className="bg-amber-50 border-amber-200">
          <h3 className="font-bold mb-2">Edit Money Entry</h3>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <TextInput type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
            <TextInput placeholder="Amount" inputMode="decimal" value={editAmount} onChange={e => setEditAmount(e.target.value)} />
            <TextInput className="col-span-2" placeholder="Notes" value={editNotes} onChange={e => setEditNotes(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleUpdateMoney}>Save Update</Button>
            <Button variant="outline" onClick={() => setEditMoney(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {editPurchase && (
        <Card className="bg-amber-50 border-amber-200">
          <h3 className="font-bold mb-2">Edit Purchase ({editPurchase.itemName})</h3>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <TextInput type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
            <TextInput placeholder="Kg" inputMode="decimal" value={editKg} onChange={e => setEditKg(e.target.value)} />
            <TextInput placeholder="Rate" inputMode="decimal" value={editRate} onChange={e => setEditRate(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleUpdatePurchase}>Save Update</Button>
            <Button variant="outline" onClick={() => setEditPurchase(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {tab === "ledger" && (
        <Card className="overflow-x-auto">
          <NativeSelect className="mb-4" value={partyId} onChange={e => setPartyId(e.target.value)}>
            <option value="">-- Select Party --</option>
            <optgroup label="Customers (Dr)">
               {d.parties.filter(p => p.kind === "customer").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
            <optgroup label="Suppliers (Cr)">
               {d.parties.filter(p => p.kind === "supplier").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          </NativeSelect>
          {selectedParty && (
            <>
              <div className="flex justify-between items-center mb-4 border-t pt-4">
                <h2 className="font-bold text-lg">{selectedParty.name}</h2>
                <Button size="sm" onClick={() => downloadCSV([["Date", "Particulars", "Debit", "Credit", "Balance"], ...ledgerEntries.map(e => [e.date, e.desc, e.debit, e.credit])], `${selectedParty!.name}_ledger.csv`)}>Export CSV</Button>
              </div>
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead><tr className="border-b"><th className="py-2">Date</th><th>Particulars</th><th className="text-right">Debit (+)</th><th className="text-right">Credit (-)</th><th className="text-right">Balance</th><th></th></tr></thead>
                <tbody>
                  <tr className="border-b text-muted bg-surface/50">
                    <td className="py-2">{fromDate}</td>
                    <td className="py-2 font-medium">Opening Balance (Brought Forward)</td>
                    <td className="py-2 text-right">--</td>
                    <td className="py-2 text-right">--</td>
                    <td className="py-2 text-right font-bold text-primary">{formatPartyBal(runningBal)}</td>
                    <td></td>
                  </tr>
                  {ledgerEntries.map((e, i) => {
                    runningBal = runningBal + e.debit - e.credit;
                    return (
                      <tr key={i} className="border-b last:border-0 hover:bg-surface/50 group">
                        <td className="py-2">{e.date}</td><td>{e.desc}</td><td className="text-right text-danger">{e.debit > 0 ? formatINR(e.debit) : ""}</td><td className="text-right text-emerald-600">{e.credit > 0 ? formatINR(e.credit) : ""}</td><td className="text-right font-medium">{formatPartyBal(runningBal)}</td>
                        <td className="text-right pl-4">
                          {e.source.type ? (
                            <button className="text-primary text-xs opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => { setEditMoney(e.source); setEditAmount(String(e.source.amount)); setEditDate(e.source.date); setEditNotes(e.source.notes); window.scrollTo(0, 0); }}>Edit</button>
                          ) : e.source.itemName ? (
                            <button className="text-primary text-xs opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => { setEditPurchase(e.source); setEditKg(String(e.source.kg)); setEditRate(String(e.source.rate)); setEditDate(e.source.date); window.scrollTo(0, 0); }}>Edit</button>
                          ) : (
                            <button className="text-danger text-xs opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDeleteBill(e.source)}>Delete</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </Card>
      )}

      {tab === "sales" && (
        <Card className="overflow-x-auto">
          <div className="flex justify-between mb-3">
            <h2 className="font-bold">Sales Register</h2>
            <Button size="sm" onClick={() => downloadCSV([["Date", "Customer", "Type", "Total"], ...sales.map(s => [s.date, s.customerName, s.saleType, s.total])], "sales.csv")}>Export CSV</Button>
          </div>
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead><tr className="border-b"><th className="py-2">Date</th><th>Customer</th><th>Type</th><th className="text-right">Total</th><th></th></tr></thead>
            <tbody>
              {sales.map(s => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-surface/50 group">
                  <td className="py-2">{s.date}</td><td>{s.customerName}</td><td className="text-muted">{s.saleType}</td><td className="text-right">{formatINR(s.total)}</td>
                  <td className="text-right pl-4"><button className="text-danger text-xs opacity-0 group-hover:opacity-100" onClick={() => handleDeleteBill(s)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "purchases" && (
        <Card className="overflow-x-auto">
          <div className="flex justify-between mb-3">
            <h2 className="font-bold">Purchase Register</h2>
            <Button size="sm" onClick={() => downloadCSV([["Date", "Supplier", "Item", "Kg", "Total"], ...purchases.map(p => [p.date, p.supplierName, p.itemName, p.kg, p.total])], "purchases.csv")}>Export CSV</Button>
          </div>
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead><tr className="border-b"><th className="py-2">Date</th><th>Supplier</th><th>Item</th><th className="text-right">Total</th><th></th></tr></thead>
            <tbody>
              {purchases.map(p => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-surface/50 group">
                  <td className="py-2">{p.date}</td><td>{p.supplierName}</td><td className="text-muted">{p.itemName} ({p.kg}kg)</td><td className="text-right">{formatINR(p.total)}</td>
                  <td className="text-right pl-4"><button className="text-primary text-xs opacity-0 group-hover:opacity-100" onClick={() => { setEditPurchase(p); setEditKg(String(p.kg)); setEditRate(String(p.rate)); setEditDate(p.date); window.scrollTo(0, 0); }}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "stock" && (
        <Card className="overflow-x-auto">
           <div className="flex justify-between mb-3">
            <h2 className="font-bold">Current Godown Stock</h2>
            <Button size="sm" onClick={() => downloadCSV([["Item", "Current Kg", "Status", "Sold 30d"], ...d.stockInsights.map(s => [s.itemName, s.currentKg, s.status, s.soldLast30DaysKg])], "stock.csv")}>Export CSV</Button>
          </div>
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead><tr className="border-b"><th className="py-2">Item</th><th className="text-right">Current Stock</th><th className="text-right">Sold (30d)</th></tr></thead>
            <tbody>
              {d.stockInsights.map(s => (
                <tr key={s.itemId} className="border-b last:border-0"><td className="py-2">{s.itemName}</td><td className="text-right font-bold">{formatKg(s.currentKg)}</td><td className="text-right text-muted">{formatKg(s.soldLast30DaysKg)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "debtors" && (
        <Card className="overflow-x-auto">
           <div className="flex justify-between mb-3">
            <h2 className="font-bold">Debtors & Creditors</h2>
            <Button size="sm" onClick={() => downloadCSV([["Party", "Balance"], ...debtors.map(p => [p.name, p.currentBalance])], "debtors.csv")}>Export CSV</Button>
          </div>
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead><tr className="border-b"><th className="py-2">Party</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {debtors.map(p => (
                <tr key={p.id} className="border-b last:border-0"><td className="py-2">{p.name}</td><td className={`text-right font-medium ${p.currentBalance > 0 ? "text-danger" : "text-emerald-600"}`}>{formatPartyBal(p.currentBalance)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export function Settings() {
  const { user } = useAuth();
  const [typed, setTyped] = useState("");
  
  const [items, setItems] = useState<Item[]>([]);
  const [editItemId, setEditItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemRate, setItemRate] = useState("");
  const [itemOpeningStock, setItemOpeningStock] = useState("");
  
  const [parties, setParties] = useState<Party[]>([]);
  const [editPartyId, setEditPartyId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyKind, setPartyKind] = useState<"customer"|"supplier">("customer");
  const [partyCreditDays, setPartyCreditDays] = useState("7");
  const [partyOpeningBal, setPartyOpeningBal] = useState("");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editAccId, setEditAccId] = useState("");
  const [accName, setAccName] = useState("");
  const [accType, setAccType] = useState<"cash"|"bank">("bank");
  const [accOpening, setAccOpening] = useState("");

  const [newPin, setNewPin] = useState("");

  const refresh = () => {
    if (user) {
      listItems(user.uid).then(setItems);
      listParties(user.uid).then(setParties);
      listAccounts(user.uid).then(setAccounts);
    }
  };

  useEffect(() => { refresh(); }, [user]);

  const handleUpdatePin = async () => {
    if (!user || newPin.length < 4) return alert("PIN must be at least 4 digits");
    await saveSecurityPin(user.uid, newPin);
    setNewPin("");
    alert("Security M-PIN updated successfully.");
  };

  const handleSaveAccount = async () => {
    if (!user || !accName) return;
    await saveAccount(user.uid, { name: accName, type: accType, openingBalance: n(accOpening) }, editAccId || undefined);
    setEditAccId(""); setAccName(""); setAccOpening("");
    refresh();
  };

  const handleDeleteAccount = async (id: string) => {
    if (!user || !confirm("Delete this account?")) return;
    await deleteAccount(user.uid, id);
    refresh();
  }

  const handleSaveItem = async () => {
    if (!user || !itemName || n(itemRate) < 0) return;
    await saveItem(user.uid, { name: itemName, baseRate: n(itemRate), openingStock: n(itemOpeningStock) }, editItemId || undefined);
    setEditItemId(""); setItemName(""); setItemRate(""); setItemOpeningStock("");
    refresh();
  };

  const handleDeleteItem = async (id: string) => {
    if (!user || !confirm("Delete this item?")) return;
    await deleteItem(user.uid, id);
    refresh();
  }

  const handleSaveParty = async () => {
    if (!user || !partyName) return;
    let ob = n(partyOpeningBal);
    if (partyKind === "supplier" && ob > 0) ob = -ob;

    await saveParty(user.uid, { 
      name: partyName, 
      kind: partyKind, 
      creditDays: n(partyCreditDays) || 7, 
      openingBalance: ob,
      phone: "",
      address: ""
    }, editPartyId || undefined);
    setEditPartyId(""); setPartyName(""); setPartyOpeningBal(""); setPartyCreditDays("7");
    refresh();
  };

  const handleDeleteParty = async (id: string) => {
    if (!user || !confirm("Delete this party?")) return;
    await deleteParty(user.uid, id);
    refresh();
  }

  return (
    <div className="space-y-4 pb-12">
      <h1 className="font-display text-3xl">Settings</h1>
      
      <Card>
        <h2 className="font-medium">Security Details</h2>
        <p className="text-sm text-muted mt-1">Change your 4-digit M-PIN. This locks the app when you close the tab.</p>
        <div className="flex gap-2 mt-3">
           <TextInput type="password" inputMode="numeric" pattern="[0-9]*" placeholder="New M-PIN" value={newPin} onChange={e => setNewPin(e.target.value)} />
           <Button onClick={handleUpdatePin}>Update PIN</Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-medium">Manage Accounts</h2>
        <div className="mt-3 space-y-2">
          {accounts.map(a => (
            <div key={a.id} className="flex justify-between items-center border-b pb-1 text-sm">
              <span>{a.name} ({a.type})</span>
              <div className="flex items-center gap-3">
                <span className="text-muted">Balance: {formatINR(a.balance || 0)}</span>
                <button onClick={() => { setEditAccId(a.id); setAccName(a.name); setAccType(a.type); setAccOpening(String(a.openingBalance)); window.scrollTo(0, document.body.scrollHeight); }} className="text-primary text-xs hover:underline">Edit</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <TextInput placeholder="Account name" value={accName} onChange={e => setAccName(e.target.value)} />
          <NativeSelect value={accType} onChange={e => setAccType(e.target.value as "cash"|"bank")}>
            <option value="bank">Bank Account</option>
            <option value="cash">Cash Till</option>
          </NativeSelect>
          <TextInput placeholder="Opening Balance" inputMode="decimal" value={accOpening} onChange={e => setAccOpening(e.target.value)} />
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" onClick={handleSaveAccount}>{editAccId ? "Update Account" : "Add Account"}</Button>
          {editAccId && <Button variant="outline" onClick={() => { setEditAccId(""); setAccName(""); setAccOpening(""); }}>Cancel Edit</Button>}
        </div>
      </Card>

      <Card>
        <h2 className="font-medium">Manage Parties</h2>
        <div className="mt-3 space-y-2">
          {parties.map(p => (
            <div key={p.id} className="flex justify-between items-center border-b pb-1 text-sm">
              <span>{p.name} ({p.kind})</span>
              <div className="flex items-center gap-3">
                <span className="text-muted">Balance: {formatPartyBal(p.currentBalance)}</span>
                <button onClick={() => { setEditPartyId(p.id); setPartyName(p.name); setPartyKind(p.kind); setPartyOpeningBal(String(Math.abs(p.openingBalance))); setPartyCreditDays(String(p.creditDays)); window.scrollTo(0, document.body.scrollHeight); }} className="text-primary text-xs hover:underline">Edit</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          <TextInput placeholder="Party name" value={partyName} onChange={e => setPartyName(e.target.value)} />
          <NativeSelect value={partyKind} onChange={e => setPartyKind(e.target.value as any)}>
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
          </NativeSelect>
          <TextInput placeholder="Opening Balance" inputMode="decimal" value={partyOpeningBal} onChange={e => setPartyOpeningBal(e.target.value)} />
          <TextInput placeholder="Credit Limit (Days)" inputMode="numeric" value={partyCreditDays} onChange={e => setPartyCreditDays(e.target.value)} />
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" onClick={handleSaveParty}>{editPartyId ? "Update Party" : "Add Party"}</Button>
          {editPartyId && <Button variant="outline" onClick={() => { setEditPartyId(""); setPartyName(""); setPartyOpeningBal(""); setPartyCreditDays("7"); }}>Cancel Edit</Button>}
        </div>
      </Card>

      <Card>
        <h2 className="font-medium">Manage Items</h2>
        <div className="mt-3 space-y-2">
          {items.map(i => (
            <div key={i.id} className="flex justify-between items-center border-b pb-1 text-sm">
              <span>{i.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-muted">Base: ₹{i.baseRate} | Open: {formatKg(i.openingStock || 0)}</span>
                <button onClick={() => { setEditItemId(i.id); setItemName(i.name); setItemRate(String(i.baseRate)); setItemOpeningStock(String(i.openingStock)); window.scrollTo(0, document.body.scrollHeight); }} className="text-primary text-xs hover:underline">Edit</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <TextInput placeholder="Item name" value={itemName} onChange={e => setItemName(e.target.value)} />
          <TextInput placeholder="Base rate" inputMode="decimal" value={itemRate} onChange={e => setItemRate(e.target.value)} />
          <TextInput placeholder="Opening Stock (Kg)" inputMode="decimal" value={itemOpeningStock} onChange={e => setItemOpeningStock(e.target.value)} />
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" onClick={handleSaveItem}>{editItemId ? "Update Item" : "Add Item"}</Button>
          {editItemId && <Button variant="outline" onClick={() => { setEditItemId(""); setItemName(""); setItemRate(""); setItemOpeningStock(""); }}>Cancel Edit</Button>}
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