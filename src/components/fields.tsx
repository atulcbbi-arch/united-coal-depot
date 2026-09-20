import { useMemo } from "react";
import { Label, NativeSelect, TextInput } from "@/components/ui";
import type { Party } from "@/lib/types";
import { LIVE_FROM, cn, isDecimalTyping, todayISO } from "@/lib/utils";

export function DateField({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>Date</Label>
      <TextInput id={id} type="date" min={LIVE_FROM} value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="mt-1 text-xs text-subtle">Books start 1 Sep 2026. Opening is 31 Aug 2026.</p>
    </div>
  );
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  suffix,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <TextInput
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            if (isDecimalTyping(next)) onChange(next);
          }}
          className={suffix ? "pr-12" : undefined}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-subtle">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function PartySelect({
  parties,
  value,
  onChange,
  allowEmpty = false,
}: {
  parties: Party[];
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <div>
      <Label htmlFor="party">Party</Label>
      <NativeSelect id="party" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allowEmpty ? "No party" : "Select party"}</option>
        {parties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.chase ? " · Chase" : ""}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function ChaseCheckbox({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label htmlFor={id} className={cn("inline-flex min-h-11 items-center gap-2", disabled ? "opacity-60" : "cursor-pointer")}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 accent-primary"
      />
      <span className="text-sm font-medium">Chase</span>
    </label>
  );
}

export function useDefaultDate() {
  return useMemo(() => todayISO(), []);
}
