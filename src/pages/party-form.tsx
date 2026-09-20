import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { EmptyHint, EntryRow } from "@/components/entry-list";
import { ChaseCheckbox, NumberField } from "@/components/fields";
import { Button, Card, Label, NativeSelect, TextArea, TextInput } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { getParty, saveParty, setPartyChase } from "@/lib/store";
import type { Entry, PartyKind } from "@/lib/types";
import { OPENING_AS_OF, formatDate, formatINR } from "@/lib/utils";

export function NewPartyPage() {
  return <PartyEditor />;
}

export function PartyDetailPage() {
  const { partyId } = useParams();
  return <PartyEditor id={partyId} />;
}

function PartyEditor({ id }: { id?: string }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState<PartyKind>("customer");
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingSide, setOpeningSide] = useState<"receivable" | "payable">("receivable");
  const [chase, setChase] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!id);
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [balance, setBalance] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !id) return;
    void getParty(user.uid, id).then(({ party, ledger: rows }) => {
      setName(party.name);
      setPhone(party.phone);
      setKind(party.kind);
      setOpeningAmount(party.openingBalance === 0 ? "" : String(Math.abs(party.openingBalance)));
      setOpeningSide(party.openingBalance < 0 ? "payable" : "receivable");
      setChase(party.chase);
      setNotes(party.notes);
      setLedger(rows);
      setOpeningBalance(party.openingBalance);
      setBalance(party.balance);
    });
  }, [user, id]);

  const running = useMemo(() => {
    let bal = openingBalance;
    return ledger.map((e) => {
      bal += e.partyDelta;
      return { ...e, running: bal };
    });
  }, [ledger, openingBalance]);

  async function onSave() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveParty(user.uid, {
        id,
        name,
        phone,
        kind,
        openingAmount,
        openingSide,
        chase,
        notes,
      });
      toast.success(id ? "Party updated" : "Party saved");
      if (!id) nav(`/parties/${res.id}`);
      else setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (id && !name && ledger.length === 0 && openingBalance === 0 && !editing) {
    return <EmptyHint>Loading…</EmptyHint>;
  }

  return (
    <div className="space-y-5">
      {id ? (
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl tracking-tight">{name || "Party"}</h1>
            <p className="mt-1 text-sm text-muted">
              Running {formatINR(balance)}
              {phone ? ` · ${phone}` : ""}
            </p>
          </div>
          <ChaseCheckbox
            id="chase-detail"
            checked={chase}
            onChange={(next) => {
              setChase(next);
              if (user && id) void setPartyChase(user.uid, id, next);
            }}
          />
        </header>
      ) : (
        <header>
          <h1 className="font-display text-2xl tracking-tight">New party</h1>
          <p className="mt-1 text-sm text-muted">Opening balance is as of 31 Aug 2026.</p>
        </header>
      )}

      {id ? (
        <div className="flex flex-wrap gap-2">
          <Link to="/sale" className="rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 text-sm">
            Sale
          </Link>
          <Link to="/payment" className="rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 text-sm">
            Payment
          </Link>
          <button
            type="button"
            className="rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 text-sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Close edit" : "Edit"}
          </button>
        </div>
      ) : null}

      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          <div>
            <Label htmlFor="name">Name</Label>
            <TextInput id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <TextInput id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </div>
          <div>
            <Label htmlFor="kind">Type</Label>
            <NativeSelect id="kind" value={kind} onChange={(e) => setKind(e.target.value as PartyKind)}>
              <option value="customer">Customer</option>
              <option value="supplier">Supplier</option>
              <option value="both">Both</option>
            </NativeSelect>
          </div>
          <NumberField id="opening" label="Opening balance (31 Aug 2026)" value={openingAmount} onChange={setOpeningAmount} suffix="₹" />
          <NativeSelect value={openingSide} onChange={(e) => setOpeningSide(e.target.value as "receivable" | "payable")}>
            <option value="receivable">They owe us</option>
            <option value="payable">We owe them</option>
          </NativeSelect>
          {!id ? <ChaseCheckbox id="chase-new" checked={chase} onChange={setChase} /> : null}
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {busy ? "Saving…" : id ? "Save changes" : "Save party"}
          </Button>
        </form>
      ) : null}

      {id ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Ledger</h2>
          <Card className="p-2 sm:p-4">
            <div className="grid grid-cols-[5.5rem_1fr_auto] gap-3 border-b border-border py-3 text-sm">
              <span className="tabular-nums text-muted">{formatDate(OPENING_AS_OF)}</span>
              <span>Opening</span>
              <span className="text-right font-medium tabular-nums">{formatINR(openingBalance)}</span>
            </div>
            {running.length === 0 ? (
              <EmptyHint>No live entries from 1 Sep 2026 yet.</EmptyHint>
            ) : (
              running.map((e) => <EntryRow key={e.id} entry={e} running={e.running} />)
            )}
          </Card>
        </section>
      ) : null}
    </div>
  );
}
