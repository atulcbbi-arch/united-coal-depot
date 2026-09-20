import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Entry } from "@/lib/types";
import { KIND_LABEL, cn, formatDate, formatINR, formatKg } from "@/lib/utils";

export function EntryRow({
  entry,
  running,
  onDelete,
}: {
  entry: Entry;
  running?: number;
  onDelete?: (id: string) => void;
}) {
  return (
    <article className="grid grid-cols-[5.5rem_1fr_auto] items-start gap-x-3 border-b border-border py-3 last:border-0">
      <time dateTime={entry.date} className="pt-0.5 text-sm font-medium tabular-nums text-muted">
        {formatDate(entry.date)}
      </time>
      <div className="min-w-0">
        <p className="truncate font-medium">
          {KIND_LABEL[entry.kind] ?? entry.kind}
          {entry.partyName && entry.partyId ? (
            <>
              <span className="text-subtle"> · </span>
              <Link to={`/parties/${entry.partyId}`} className="text-pine hover:underline">
                {entry.partyName}
              </Link>
            </>
          ) : null}
        </p>
        <p className="text-sm text-muted">
          {entry.qtyKg != null ? formatKg(entry.qtyKg) : null}
          {entry.qtyKg != null && entry.rate != null ? " · " : null}
          {entry.rate != null ? `${formatINR(entry.rate)}/kg` : null}
          {entry.notes ? `${entry.qtyKg != null || entry.rate != null ? " · " : ""}${entry.notes}` : null}
          {entry.qtyKg == null && entry.rate == null && !entry.notes ? "—" : null}
        </p>
      </div>
      <div className="text-right">
        <p className={cn("font-medium tabular-nums", entry.amount === 0 ? "text-muted" : entry.partyDelta < 0 ? "text-ok" : "")}>
          {entry.amount === 0 && entry.stockDelta !== 0 ? formatKg(entry.stockDelta) : formatINR(entry.amount)}
        </p>
        {running != null ? <p className="text-xs tabular-nums text-subtle">{formatINR(running)}</p> : null}
        {onDelete ? (
          <button type="button" onClick={() => onDelete(entry.id)} className="mt-1 text-xs text-subtle hover:text-danger">
            Delete
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}
