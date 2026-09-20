import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const OPENING_AS_OF = "2026-08-31";
export const LIVE_FROM = "2026-09-01";

export function todayISO(): string {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return iso < LIVE_FROM ? LIVE_FROM : iso;
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatINR(n: number): string {
  const body = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  return n < 0 ? `−₹${body}` : `₹${body}`;
}

export function formatKg(n: number): string {
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n)} kg`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseDecimal(raw: string): number | null {
  const t = raw.trim();
  if (t === "" || t === "-" || t === "." || t === "-.") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function isDecimalTyping(raw: string): boolean {
  return raw === "" || /^-?\d*\.?\d*$/.test(raw);
}

export const KIND_LABEL: Record<string, string> = {
  sale: "Sale",
  purchase: "Purchase",
  payment_in: "Payment in",
  payment_out: "Payment out",
  expense: "Expense",
  delivery: "Delivery",
  stock_adj: "Stock adj.",
};
