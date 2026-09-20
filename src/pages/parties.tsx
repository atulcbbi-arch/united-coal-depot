import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyHint } from "@/components/entry-list";
import { ChaseCheckbox } from "@/components/fields";
import { Button, Card, TextInput } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { listParties, setPartyChase } from "@/lib/store";
import type { Party } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";

export function PartiesPage() {
  const { user } = useAuth();
  const [list, setList] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [qtext, setQtext] = useState("");
  const [chaseOnly, setChaseOnly] = useState(false);

  async function refresh() {
    if (!user) return;
    const rows = await listParties(user.uid);
    setList(rows);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, [user]);

  const rows = useMemo(() => {
    const needle = qtext.trim().toLowerCase();
    return list.filter((p) => {
      if (chaseOnly && !p.chase) return false;
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle) || p.phone.includes(needle);
    });
  }, [list, qtext, chaseOnly]);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Parties</h1>
          <p className="mt-1 text-sm text-muted">Tick Chase on the row. It saves immediately.</p>
        </div>
        <Link
          to="/parties/new"
          className="inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] bg-primary px-4 text-sm font-medium text-primary-fg"
        >
          New
        </Link>
      </header>
      <div className="flex gap-2">
        <TextInput value={qtext} onChange={(e) => setQtext(e.target.value)} placeholder="Search name or phone" className="flex-1" />
        <Button variant={chaseOnly ? "coal" : "outline"} onClick={() => setChaseOnly((v) => !v)}>
          Chase
        </Button>
      </div>
      {loading ? (
        <div className="h-24 animate-pulse rounded-[var(--radius-lg)] bg-border/70" />
      ) : rows.length === 0 ? (
        <EmptyHint>{list.length ? "No parties match." : "No parties yet. Add one to start the books."}</EmptyHint>
      ) : (
        <Card className="p-0">
          <ul>
            {rows.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0">
                <Link to={`/parties/${p.id}`} className="min-w-0 flex-1 py-2">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-sm tabular-nums text-muted">
                    {formatINR(p.balance)}
                    {p.balance > 0 ? " due" : p.balance < 0 ? " payable" : ""}
                    {p.phone ? ` · ${p.phone}` : ""}
                  </p>
                </Link>
                <ChaseCheckbox
                  id={`chase-${p.id}`}
                  checked={p.chase}
                  onChange={(next) => {
                    if (!user) return;
                    setList((old) =>
                      old
                        .map((x) => (x.id === p.id ? { ...x, chase: next } : x))
                        .sort((a, b) => Number(b.chase) - Number(a.chase) || a.name.localeCompare(b.name)),
                    );
                    void setPartyChase(user.uid, p.id, next).catch(() => {
                      toast.error("Could not update Chase");
                      void refresh();
                    });
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
