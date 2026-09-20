import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyHint, EntryRow } from "@/components/entry-list";
import { Card } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { getDashboard } from "@/lib/store";
import { formatINR, formatKg } from "@/lib/utils";
import type { Entry } from "@/lib/types";

export function HomePage() {
  const { user } = useAuth();
  const [d, setD] = useState<{
    stockKg: number;
    receivable: number;
    payable: number;
    chaseCount: number;
    recent: Entry[];
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    void getDashboard(user.uid).then(setD);
  }, [user]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl tracking-tight">Home</h1>
        <p className="mt-1 text-sm text-muted">Opening 31 Aug 2026 · live from 1 Sep 2026</p>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Stock" value={d ? formatKg(d.stockKg) : "—"} />
        <Stat label="Receivable" value={d ? formatINR(d.receivable) : "—"} />
        <Stat label="Payable" value={d ? formatINR(d.payable) : "—"} />
        <Link to="/parties">
          <Stat label="Chase" value={d ? String(d.chaseCount) : "—"} />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          ["/sale", "Sale"],
          ["/purchase", "Purchase"],
          ["/payment", "Payment"],
          ["/expense", "Expense"],
          ["/delivery", "Delivery"],
          ["/stock", "Stock adj."],
        ].map(([to, label]) => (
          <Link
            key={to}
            to={to}
            className="flex h-11 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-card text-sm font-medium"
          >
            {label}
          </Link>
        ))}
      </div>
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent</h2>
          <Link to="/books" className="text-sm text-pine hover:underline">
            Books
          </Link>
        </div>
        <Card className="p-2 sm:p-4">
          {d?.recent.length ? (
            d.recent.map((e) => <EntryRow key={e.id} entry={e} />)
          ) : (
            <EmptyHint>No entries yet. Record a sale or payment dated 1 Sep 2026 or later.</EmptyHint>
          )}
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-xl tabular-nums tracking-tight">{value}</p>
    </Card>
  );
}
