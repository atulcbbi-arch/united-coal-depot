import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EmptyHint, EntryRow } from "@/components/entry-list";
import { DateField, NumberField, PartySelect, useDefaultDate } from "@/components/fields";
import { Button, Card, Label, NativeSelect, TextArea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  deleteEntry,
  getDashboard,
  getOpeningStock,
  listEntries,
  listParties,
  saveDelivery,
  saveExpense,
  saveOpeningStock,
  savePayment,
  savePurchase,
  saveSale,
  saveStockAdj,
} from "@/lib/store";
import type { Entry, Party } from "@/lib/types";
import { KIND_LABEL, cn, formatKg, parseDecimal, round2 } from "@/lib/utils";

function useParties() {
  const { user } = useAuth();
  const [parties, setParties] = useState<Party[]>([]);
  useEffect(() => {
    if (!user) return;
    void listParties(user.uid).then(setParties);
  }, [user]);
  return parties;
}

function useUid() {
  const { user } = useAuth();
  return user?.uid ?? "";
}

type MoneyKind = "sale" | "purchase" | "delivery";
const MONEY_COPY: Record<MoneyKind, { title: string; hint: string; success: string }> = {
  sale: { title: "Sale", hint: "Coal out. Party balance goes up (they owe us).", success: "Sale saved" },
  purchase: { title: "Purchase", hint: "Coal in. Party balance goes down (we owe them).", success: "Purchase saved" },
  delivery: {
    title: "Delivery / order",
    hint: "Stock goes out to the party. Amount is optional — fill it only if this load is billed.",
    success: "Delivery saved",
  },
};

export function MoneyPage({ kind }: { kind: MoneyKind }) {
  const uid = useUid();
  const nav = useNavigate();
  const parties = useParties();
  const [date, setDate] = useState(useDefaultDate());
  const [partyId, setPartyId] = useState("");
  const [kg, setKg] = useState("");
  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const computed = useMemo(() => {
    const k = parseDecimal(kg);
    const r = parseDecimal(rate);
    if (k == null || r == null) return null;
    return round2(k * r);
  }, [kg, rate]);
  const shownAmount = amountTouched ? amount : computed != null ? String(computed) : amount;
  const copy = MONEY_COPY[kind];

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        const payload = { partyId, date, kg, rate, amount: shownAmount, notes };
        const run =
          kind === "sale" ? saveSale(uid, payload) : kind === "purchase" ? savePurchase(uid, payload) : saveDelivery(uid, payload);
        void run
          .then(() => {
            toast.success(copy.success);
            nav("/books");
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save"))
          .finally(() => setBusy(false));
      }}
    >
      <header>
        <h1 className="font-display text-2xl tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted">{copy.hint}</p>
      </header>
      <DateField value={date} onChange={setDate} />
      <PartySelect parties={parties} value={partyId} onChange={setPartyId} />
      {parties.length === 0 ? (
        <p className="text-sm text-muted">
          No parties yet. <Link to="/parties/new" className="text-pine hover:underline">Add a party</Link>.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <NumberField id="kg" label="Kg" value={kg} onChange={setKg} suffix="kg" />
        <NumberField id="rate" label="Rate" value={rate} onChange={setRate} suffix="₹/kg" />
      </div>
      <NumberField
        id="amount"
        label="Amount"
        value={shownAmount}
        onChange={(v) => {
          setAmountTouched(true);
          setAmount(v);
        }}
        suffix="₹"
      />
      <div>
        <Label htmlFor="notes">Notes</Label>
        <TextArea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" className="w-full" size="lg" disabled={busy}>
        {busy ? "Saving…" : `Save ${copy.title.toLowerCase()}`}
      </Button>
    </form>
  );
}

export function PaymentPage() {
  const uid = useUid();
  const nav = useNavigate();
  const parties = useParties();
  const [date, setDate] = useState(useDefaultDate());
  const [partyId, setPartyId] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void savePayment(uid, { partyId, date, amount, direction, notes })
          .then(() => {
            toast.success("Payment saved");
            nav("/books");
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save"))
          .finally(() => setBusy(false));
      }}
    >
      <header>
        <h1 className="font-display text-2xl tracking-tight">Payment</h1>
        <p className="mt-1 text-sm text-muted">Cash in from a party, or cash paid to a party.</p>
      </header>
      <DateField value={date} onChange={setDate} />
      <PartySelect parties={parties} value={partyId} onChange={setPartyId} />
      <div>
        <Label>Direction</Label>
        <div className="grid grid-cols-2 gap-2">
          {(["in", "out"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={cn(
                "h-11 rounded-[var(--radius-sm)] border text-sm font-medium",
                direction === d ? "border-primary bg-primary text-primary-fg" : "border-border bg-card",
              )}
            >
              {d === "in" ? "Received" : "Paid"}
            </button>
          ))}
        </div>
      </div>
      <NumberField id="amount" label="Amount" value={amount} onChange={setAmount} suffix="₹" />
      <div>
        <Label htmlFor="notes">Notes</Label>
        <TextArea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" className="w-full" size="lg" disabled={busy}>
        {busy ? "Saving…" : "Save payment"}
      </Button>
    </form>
  );
}

export function ExpensePage() {
  const uid = useUid();
  const nav = useNavigate();
  const parties = useParties();
  const [date, setDate] = useState(useDefaultDate());
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void saveExpense(uid, { date, amount, notes, partyId })
          .then(() => {
            toast.success("Expense saved");
            nav("/books");
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save"))
          .finally(() => setBusy(false));
      }}
    >
      <header>
        <h1 className="font-display text-2xl tracking-tight">Expense</h1>
        <p className="mt-1 text-sm text-muted">Depot cost. Does not change a party running balance.</p>
      </header>
      <DateField value={date} onChange={setDate} />
      <NumberField id="amount" label="Amount" value={amount} onChange={setAmount} suffix="₹" />
      <PartySelect parties={parties} value={partyId} onChange={setPartyId} allowEmpty />
      <div>
        <Label htmlFor="notes">Notes</Label>
        <TextArea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" className="w-full" size="lg" disabled={busy}>
        {busy ? "Saving…" : "Save expense"}
      </Button>
    </form>
  );
}

export function StockPage() {
  const uid = useUid();
  const [openingKg, setOpeningKg] = useState("");
  const [stockKg, setStockKg] = useState<number | null>(null);
  const [date, setDate] = useState(useDefaultDate());
  const [kg, setKg] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return;
    void Promise.all([getOpeningStock(uid), getDashboard(uid)]).then(([o, d]) => {
      setOpeningKg(o.openingStockKg === 0 ? "" : String(o.openingStockKg));
      setStockKg(d.stockKg);
    });
  }, [uid]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl tracking-tight">Stock</h1>
        <p className="mt-1 text-sm text-muted">
          On hand {stockKg == null ? "—" : formatKg(stockKg)} · opening as of 31 Aug 2026
        </p>
      </header>
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Opening stock</h2>
        <NumberField id="opening-kg" label="Kg as of 31 Aug 2026" value={openingKg} onChange={setOpeningKg} suffix="kg" />
        <Button
          onClick={() => {
            void saveOpeningStock(uid, openingKg).then(() => toast.success("Opening stock saved (31 Aug 2026)"));
          }}
        >
          Save opening
        </Button>
      </Card>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void saveStockAdj(uid, { date, kg, direction, notes })
            .then(() => {
              toast.success("Stock adjustment saved");
              setKg("");
              setNotes("");
              return getDashboard(uid);
            })
            .then((d) => setStockKg(d.stockKg))
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save"))
            .finally(() => setBusy(false));
        }}
      >
        <h2 className="font-display text-xl tracking-tight">Adjustment</h2>
        <DateField value={date} onChange={setDate} />
        <div>
          <Label>Direction</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["in", "out"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={cn(
                  "h-11 rounded-[var(--radius-sm)] border text-sm font-medium",
                  direction === d ? "border-primary bg-primary text-primary-fg" : "border-border bg-card",
                )}
              >
                {d === "in" ? "Stock in" : "Stock out"}
              </button>
            ))}
          </div>
        </div>
        <NumberField id="adj-kg" label="Kg" value={kg} onChange={setKg} suffix="kg" />
        <div>
          <Label htmlFor="adj-notes">Notes</Label>
          <TextArea id="adj-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          {busy ? "Saving…" : "Save adjustment"}
        </Button>
      </form>
    </div>
  );
}

export function BooksPage() {
  const uid = useUid();
  const [rows, setRows] = useState<Entry[]>([]);
  const [kind, setKind] = useState("all");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const list = await listEntries(uid);
    setRows(list);
    setLoading(false);
  }
  useEffect(() => {
    if (uid) void refresh();
  }, [uid]);

  const shown = kind === "all" ? rows : rows.filter((e) => e.kind === kind);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl tracking-tight">Books</h1>
        <p className="mt-1 text-sm text-muted">Every money and stock movement, with its date.</p>
      </header>
      <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="all">All kinds</option>
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </NativeSelect>
      {loading ? (
        <div className="h-32 animate-pulse rounded-[var(--radius-lg)] bg-border/70" />
      ) : (
        <Card className="p-2 sm:p-4">
          {shown.length === 0 ? (
            <EmptyHint>No entries dated 1 Sep 2026 or later.</EmptyHint>
          ) : (
            shown.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                onDelete={(id) => {
                  if (!confirm("Delete this entry?")) return;
                  void deleteEntry(uid, id).then(() => refresh());
                }}
              />
            ))
          )}
        </Card>
      )}
    </div>
  );
}

export function MorePage() {
  const items = [
    { to: "/purchase", label: "Purchase", hint: "Coal in, payable up" },
    { to: "/payment", label: "Payment", hint: "Received or paid" },
    { to: "/expense", label: "Expense", hint: "Depot costs" },
    { to: "/delivery", label: "Delivery / order", hint: "Stock out to a party" },
    { to: "/stock", label: "Stock", hint: "Opening + adjustments" },
  ];
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl tracking-tight">More</h1>
        <p className="mt-1 text-sm text-muted">Purchase, payments, expenses, deliveries, stock.</p>
      </header>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="flex min-h-14 flex-col justify-center rounded-[var(--radius-md)] border border-border bg-card px-4 py-3"
            >
              <span className="font-medium">{item.label}</span>
              <span className="text-sm text-muted">{item.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
