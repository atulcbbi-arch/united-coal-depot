// United Coal Depot — Telegram voice/text control (v2)
// Every action: voice/text -> AI -> draft card -> you tap ✅ -> posted. Queries answer instantly.
// Self-contained on purpose (no relative imports) so Vercel bundles it without surprises.

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export const config = { maxDuration: 60 };

// ---------- env ----------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN || "";
const OWNER_IDS = (process.env.TELEGRAM_CHAT_ID || process.env.VITE_TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODELS = [...new Set([process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.0-flash"].filter(Boolean) as string[])];
const LIVE_FROM = "2026-09-01";
const WEBHOOK_SECRET = createHash("sha256").update("ucd-webhook:" + BOT_TOKEN).digest("hex").slice(0, 48);

const db = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "",
  { auth: { persistSession: false } }
);

// ---------- types ----------
const ENTRY_ACTS = ["payment_in", "payment_out", "expense", "cheque_in", "clear_cheque", "sale", "sale_return", "purchase", "purchase_return",
  "mark_delivered", "cancel_delivery", "create_party", "update_party", "create_item", "update_item", "stock_adjust",
  "create_account", "update_account", "delete_entry"] as const;
type Act = typeof ENTRY_ACTS[number];
interface Line { itemId: string | null; itemName: string; kg: number; rate: number | null; amount: number | null; auto?: boolean; }
interface Target { table: "bills" | "money" | "purchases"; id: string; label: string; }
interface Master {
  name?: string | null; newName?: string | null; kind?: string | null; phone?: string | null; address?: string | null;
  creditDays?: number | null; opening?: number | null; side?: "dr" | "cr" | null;
  baseRate?: number | null; openingStock?: number | null; stockDelta?: number | null; accType?: string | null;
}
interface Draft {
  act: Act; date: string; amount: number | null;
  partyId: string | null; partyName: string; heardParty: string | null; partyCandidates: string[];
  mode: string | null; lines: Line[]; deliveryCharge: number; deliveryDate: string | null; notes: string; heard: string;
  chequeNo: string; clearanceDate: string;
  itemId: string | null; heardItem: string | null; accountId: string | null; heardAccount: string | null;
  entryType: string | null; target: Target | null; targets: Target[];
  master: Master; msgId?: number;
}
type M = { parties: any[]; accounts: any[]; items: any[] };

// ---------- utils ----------
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inr = (n: number) => (n < 0 ? "−" : "") + "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Math.abs(n));
const kgf = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n) + " kg";
const drcr = (b: number) => (b > 0 ? `${inr(b)} Dr` : b < 0 ? `${inr(-b)} Cr` : "₹0");
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const fmtDate = (iso: string) => (iso ? new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const isDate = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
function norm(s: string) {
  return (s || "").toLowerCase().replace(/m\/s|\bmessrs\b|\bshri\b|\bsh\.|\bthe\b/g, " ").replace(/[^a-z0-9\u0900-\u0D7F ]/g, " ").replace(/\s+/g, " ").trim();
}
function lev(a: string, b: string) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function similarity(a: string, b: string) {
  const x = norm(a), y = norm(b); if (!x || !y) return 0; if (x === y) return 1;
  const xs = x.replace(/ /g, ""), ys = y.replace(/ /g, ""); if (xs === ys) return 0.98;
  let s = 1 - lev(xs, ys) / Math.max(xs.length, ys.length);
  if (xs.includes(ys) || ys.includes(xs)) s = Math.max(s, 0.85);
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" "));
  const jac = [...tx].filter((t) => ty.has(t)).length / new Set([...tx, ...ty]).size;
  return Math.max(s, jac * 0.95);
}
const rank = <T extends { name: string }>(list: T[], q: string) => list.map((o) => ({ o, s: similarity(o.name, q) })).sort((a, b) => b.s - a.s);
function pickOne<T extends { name: string }>(list: T[], q: string | null | undefined, min = 0.85) {
  if (!q) return { hit: null as T | null, cands: [] as T[] };
  const r = rank(list, q); const [a, b] = r;
  if (a && a.s >= min && (!b || a.s - b.s >= 0.08 || a.s === 1)) return { hit: a.o, cands: [] as T[] };
  return { hit: null, cands: r.filter((x) => x.s >= 0.35).slice(0, 4).map((x) => x.o) };
}

// ---------- telegram ----------
async function tg(method: string, body: any) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}
const send = (chat_id: any, text: string, reply_markup?: any) => tg("sendMessage", { chat_id, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, reply_markup });
const edit = (chat_id: any, message_id: number, text: string, reply_markup?: any) => tg("editMessageText", { chat_id, message_id, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, reply_markup });

// ---------- data ----------
async function loadMasters(): Promise<M> {
  const [p, a, i] = await Promise.all([
    db.from("parties").select("*"), db.from("accounts").select("*"), db.from("items").select("*"),
  ]);
  if (p.error) throw new Error("Supabase read failed: " + p.error.message);
  return { parties: p.data || [], accounts: a.data || [], items: i.data || [] };
}
async function adjAccount(id: string, delta: number) {
  const { data: a, error } = await db.from("accounts").select("balance").eq("id", id).single();
  if (error || !a) throw new Error("Account not found");
  const { error: e } = await db.from("accounts").update({ balance: r2((a.balance || 0) + delta) }).eq("id", id);
  if (e) throw new Error("Account update failed: " + e.message);
}
async function adjParty(id: string, delta: number, extra: any = {}) {
  const { data: p, error } = await db.from("parties").select("currentBalance").eq("id", id).single();
  if (error || !p) throw new Error("Party not found");
  const { error: e } = await db.from("parties").update({ ...extra, currentBalance: r2((p.currentBalance || 0) + delta) }).eq("id", id);
  if (e) throw new Error("Party update failed: " + e.message);
}
async function must<T>(q: PromiseLike<{ data: T; error: any }>, what: string): Promise<T> {
  const { data, error } = await q; if (error) throw new Error(`${what}: ${error.message}`); return data;
}

// ---------- AI ----------
async function understand(input: { text?: string; audioB64?: string; mime?: string }, m: M) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is not set in Vercel.");
  const today = istToday();
  const prompt = `You are the data-entry clerk of "United Coal Depot", a coal trading business in Punjab, India.
The owner speaks or types instructions in English, Hindi, Punjabi or Hinglish. Turn them into JSON actions.
Today (IST) is ${today}. "aaj"=today; "kal" in past tense=yesterday; "parso"=2 days ago.

Known parties: ${m.parties.map((p) => `${p.name} (${p.kind})`).join("; ") || "none"}
Known cash/bank accounts: ${m.accounts.map((a) => `${a.name} (${a.type})`).join("; ") || "none"}
Known items: ${m.items.map((i) => i.name).join("; ") || "none"}

Return ONLY: {"heard": "<what you heard, Roman script>", "actions": [ <action>, ... ]}
One instruction can hold many actions (e.g. a list of opening balances) — one action each.

Each action: {"type": <type>, ...only the fields that apply}
Types and fields:
 payment_in / payment_out : party, amount, mode, date, notes        (in = received/aaya/mila/jama; out = paid/diya/bheja)
 expense                  : amount, mode, date, notes (head: diesel, labour, rent, chai, bijli...)
 cheque_in                : party, amount, cheque_number, clearance_date, date   (post-dated cheque received)
 clear_cheque             : party, amount, mode (bank account it was deposited in)
 sale / sale_return       : party (null for walk-in), mode, items, delivery_charge, delivery_date (only if FUTURE delivery), date
 purchase / purchase_return: party, mode, items, date
 mark_delivered / cancel_delivery : party (whose scheduled delivery), date
 create_party             : name, kind ("customer"|"supplier"), phone, address, credit_days, opening_balance, opening_side
 update_party             : party, new_name, kind, phone, address, credit_days, opening_balance, opening_side
 create_item              : name, base_rate, opening_stock_kg
 update_item              : item, new_name, base_rate, opening_stock_kg
 stock_adjust             : item, stock_delta_kg (+ found extra / − shortage, wastage, gala)
 create_account           : name, account_type ("cash"|"bank"), opening_balance
 update_account           : account, new_name, opening_balance
 delete_entry             : entry_type ("sale"|"purchase"|"payment_in"|"payment_out"|"expense"|"any"), party, amount, date
 query                    : query ("balance"|"stock"|"pending_deliveries"|"cheques"|"day_report"|"statement"|"parties"), party, date
 undo  (reverse my last entry)   help   unknown

Field formats: amount/rates/balances are numbers in rupees (50 hazaar=50000, 1 lakh=100000, 2.5 lakh=250000).
 mode: "cash", "bank", "credit" (udhaar / khate mein / on account), or an EXACT known account name; null if not said.
 items: [{"item": name, "kg": number, "rate": number|null (per kg), "amount": number|null}]
 Units: 1 quintal=100 kg, 1 ton/tonne=1000 kg, 1 man/maund=40 kg. Rate "per quintal" ÷100, "per ton" ÷1000.
 opening_side: "dr" if the party owes us (lena hai / baki / receivable), "cr" if we owe them (dena hai / payable); null if not said.
 dates "YYYY-MM-DD". For party/item/account names copy the EXACT known name when it sounds alike; else write the name as heard.
 If only one item is known and none is named, use that item. Never invent numbers — use null.
 "return"/"wapas"/"maal wapas aaya" from a customer = sale_return; sending stock back to a supplier = purchase_return.
 Asking balance / kitna lena-dena / hisaab = query balance (or statement if they want the ledger/khata details).`;
  const parts: any[] = [{ text: prompt }];
  if (input.audioB64) parts.push({ inline_data: { mime_type: input.mime || "audio/ogg", data: input.audioB64 } });
  if (input.text) parts.push({ text: "Owner says: " + input.text });

  let lastErr = "";
  const started = Date.now();
  // busy/overloaded models are common: try every model, then a second round after a short pause
  for (const round of [0, 1]) for (const model of GEMINI_MODELS) {
    if (Date.now() - started > 45000) break;
    if (round === 1 && model === GEMINI_MODELS[0]) await new Promise((ok) => setTimeout(ok, 2000));
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
      });
    } catch (e: any) { lastErr = `${model}: ${e?.message || "timeout"}`; continue; }
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      lastErr = `${model}: ${j?.error?.message || r.status}`;
      if (r.status === 401 || r.status === 403) throw new Error("Gemini key rejected: " + lastErr);
      continue; // busy / not found / overloaded → try next model
    }
    const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
    try {
      const o = JSON.parse(txt.replace(/```json|```/g, "").trim());
      if (Array.isArray(o)) return { heard: "", actions: o };
      if (!Array.isArray(o.actions)) o.actions = o.type ? [o] : [];
      return o;
    } catch { throw new Error("AI reply was not readable. Please say it again."); }
  }
  throw new Error("AI is busy right now, please send again in a minute. (" + lastErr + ")");
}

// ---------- resolving ----------
function resolveMode(raw: string | null, accounts: any[], allowCredit: boolean): string | null {
  if (!raw) return accounts.length === 1 && !allowCredit ? accounts[0].id : null;
  const s = norm(raw);
  if (allowCredit && /credit|udhaar|udhar|khata|khate|account/.test(s) && !accounts.some((a) => norm(a.name) === s)) return "credit";
  const best = rank(accounts, raw)[0]; if (best && best.s >= 0.8) return best.o.id;
  const type = /cash|nakad|naqad/.test(s) ? "cash" : /bank|upi|neft|rtgs|imps|cheque|check|online|gpay|phonepe|paytm|transfer/.test(s) ? "bank" : null;
  if (type) { const of = accounts.filter((a) => a.type === type); if (of.length === 1) return of[0].id; }
  return null;
}
const isTrade = (a: Act) => a === "sale" || a === "purchase" || a === "sale_return" || a === "purchase_return";
const isSaleish = (a: Act) => a === "sale" || a === "sale_return";
function setParty(d: Draft, name: string | null, m: M) {
  d.heardParty = name || null; d.partyId = null; d.partyName = ""; d.partyCandidates = [];
  if (!name) return;
  const { hit, cands } = pickOne(m.parties, name);
  if (hit) { d.partyId = hit.id; d.partyName = hit.name; } else { d.partyName = name; d.partyCandidates = cands.map((c: any) => c.id); }
}
function priceLines(d: Draft, m: M) {
  const party = m.parties.find((p) => p.id === d.partyId);
  for (const l of d.lines) {
    const it = m.items.find((x) => x.id === l.itemId);
    if ((l.rate == null || l.auto) && it && isSaleish(d.act)) { l.rate = num(party?.customRates?.[it.id] ?? it.baseRate); l.auto = true; }
    l.amount = l.rate != null && l.kg ? r2(l.kg * l.rate) : null;
  }
  if (isTrade(d.act) && d.lines.length && d.lines.every((l) => l.amount)) d.amount = r2(d.lines.reduce((s, l) => s + (l.amount || 0), 0) + (isSaleish(d.act) ? d.deliveryCharge : 0));
}

function buildDraft(a: any, heard: string, m: M): Draft {
  const today = istToday();
  let date = isDate(a.date) ? a.date : today; if (date > today) date = today; if (date < LIVE_FROM) date = LIVE_FROM;
  const act = a.type as Act;
  const d: Draft = {
    act, date, amount: num(a.amount), partyId: null, partyName: "", heardParty: null, partyCandidates: [],
    mode: null, lines: [], deliveryCharge: num(a.delivery_charge) || 0,
    deliveryDate: isDate(a.delivery_date) && a.delivery_date > today ? a.delivery_date : null,
    notes: a.notes || "", heard, chequeNo: a.cheque_number ? String(a.cheque_number) : "",
    clearanceDate: isDate(a.clearance_date) ? a.clearance_date : today,
    itemId: null, heardItem: a.item || null, accountId: null, heardAccount: a.account || null,
    entryType: a.entry_type || null, target: null, targets: [],
    master: {
      name: a.name || null, newName: a.new_name || null, kind: a.kind === "supplier" || a.kind === "customer" ? a.kind : null,
      phone: a.phone ? String(a.phone) : null, address: a.address || null, creditDays: num(a.credit_days),
      opening: num(a.opening_balance) != null ? Math.abs(num(a.opening_balance)!) : null,
      side: a.opening_side === "dr" || a.opening_side === "cr" ? a.opening_side : null,
      baseRate: num(a.base_rate), openingStock: num(a.opening_stock_kg), stockDelta: num(a.stock_delta_kg),
      accType: a.account_type === "cash" || a.account_type === "bank" ? a.account_type : null,
    },
  };
  if (act === "create_account") d.master.opening = num(a.opening_balance);
  if (act === "update_account") d.master.opening = num(a.opening_balance);

  if (act === "expense" && a.party) d.notes = [d.notes, a.party].filter(Boolean).join(" · ");
  else if (act === "create_party") d.partyName = a.name || a.party || "";
  else if (!["create_item", "update_item", "stock_adjust", "create_account", "update_account"].includes(act)) setParty(d, a.party, m);

  if (act === "update_item" || act === "stock_adjust") { const { hit } = pickOne(m.items, a.item || a.name, 0.6); d.itemId = hit?.id || (m.items.length === 1 && !a.item ? m.items[0].id : null); }
  if (act === "update_account") { const { hit } = pickOne(m.accounts, a.account || a.name, 0.6); d.accountId = hit?.id || null; }

  if (["payment_in", "payment_out", "expense"].includes(act)) d.mode = resolveMode(a.mode, m.accounts, false);
  if (act === "clear_cheque") d.mode = resolveMode(a.mode || "bank", m.accounts, false);
  if (isTrade(act)) {
    d.mode = resolveMode(a.mode, m.accounts, true);
    if (d.mode === "credit" && !a.party) d.mode = null;
    for (const it of Array.isArray(a.items) ? a.items : []) {
      let item: any = null;
      if (it.item) { const b = rank(m.items, it.item)[0]; if (b && b.s >= 0.6) item = b.o; }
      if (!item && m.items.length === 1) item = m.items[0];
      const kg = Math.abs(num(it.kg) || 0); let rate = num(it.rate); const amt = num(it.amount);
      if (rate == null && amt && kg) rate = r2(Math.abs(amt) / kg);
      d.lines.push({ itemId: item?.id || null, itemName: item?.name || it.item || "?", kg, rate: rate != null ? Math.abs(rate) : null, amount: null, auto: rate == null });
    }
    priceLines(d, m);
  }
  if (d.amount != null) d.amount = Math.abs(d.amount);
  return d;
}

// find the existing record an action points at (delivery, cheque, entry)
async function findTargets(d: Draft) {
  if (!["mark_delivered", "cancel_delivery", "clear_cheque", "delete_entry"].includes(d.act)) return;
  if (d.target) return;
  const out: Target[] = [];
  const pname = d.partyName && !d.partyId ? d.partyName : null;
  if (d.act === "mark_delivered" || d.act === "cancel_delivery") {
    const bills = await must(db.from("bills").select("*").eq("deliveryStatus", "scheduled"), "Bills");
    (bills as any[]).filter((b) => (!d.partyId || b.partyId === d.partyId) && (!pname || similarity(b.customerName, pname) >= 0.6))
      .sort((a, b) => (a.deliveryDate || a.date).localeCompare(b.deliveryDate || b.date))
      .forEach((b) => out.push({ table: "bills", id: b.id, label: `${b.customerName} · ${fmtDate(b.deliveryDate || b.date)} · ${kgf(b.lines.reduce((s: number, l: any) => s + l.kg, 0))} · ${inr(b.total)}` }));
  }
  if (d.act === "clear_cheque") {
    const ms = await must(db.from("money").select("*").eq("type", "pdc_in").eq("status", "pending"), "Cheques");
    (ms as any[]).filter((x) => (!d.partyId || x.partyId === d.partyId) && (!d.amount || Math.abs(x.amount - d.amount) < 1))
      .sort((a, b) => (a.clearanceDate || "").localeCompare(b.clearanceDate || ""))
      .forEach((x) => out.push({ table: "money", id: x.id, label: `${x.partyName} · chq ${x.chequeNumber || "-"} · ${fmtDate(x.clearanceDate)} · ${inr(x.amount)}` }));
  }
  if (d.act === "delete_entry") {
    const t = d.entryType || "any";
    const want = (k: string) => t === "any" || t === k;
    const rows: any[] = [];
    if (want("sale")) ((await must(db.from("bills").select("*"), "Bills")) as any[]).forEach((b) => rows.push({ table: "bills", r: b, date: b.date, amt: b.total, party: b.partyId, name: b.customerName, k: b.total < 0 ? "Sale return" : "Sale" }));
    if (want("purchase")) ((await must(db.from("purchases").select("*"), "Purchases")) as any[]).forEach((p) => rows.push({ table: "purchases", r: p, date: p.date, amt: p.total, party: p.partyId, name: p.supplierName, k: p.total < 0 ? "Purchase return" : "Purchase" }));
    if (want("payment_in") || want("payment_out") || want("expense")) ((await must(db.from("money").select("*"), "Money")) as any[])
      .filter((x) => t === "any" || x.type === t).forEach((x) => rows.push({ table: "money", r: x, date: x.date, amt: x.amount, party: x.partyId, name: x.partyName || x.notes, k: x.type }));
    rows.filter((x) => (!d.partyId || x.party === d.partyId) && (!pname || similarity(x.name || "", pname) >= 0.6) && (!d.amount || Math.abs(Math.abs(x.amt) - d.amount) < 1))
      .sort((a, b) => (b.date + (b.r.created_at || "")).localeCompare(a.date + (a.r.created_at || ""))).slice(0, 5)
      .forEach((x) => out.push({ table: x.table, id: x.r.id, label: `${x.k} · ${x.name || "-"} · ${fmtDate(x.date)} · ${inr(x.amt)}` }));
  }
  d.targets = out.slice(0, 6);
  if (out.length === 1) d.target = out[0];
}

function signedOpening(d: Draft, kind: string | null) {
  if (d.master.opening == null) return null;
  const neg = d.master.side ? d.master.side === "cr" : kind === "supplier";
  return neg ? -d.master.opening : d.master.opening;
}

// what is still missing (first thing to ask)
function missing(d: Draft): string | null {
  const a = d.act, M = d.master;
  switch (a) {
    case "payment_in": case "payment_out": return !d.partyId ? "party" : !d.amount ? "amount" : !d.mode ? "mode" : null;
    case "expense": return !d.amount ? "amount" : !d.mode ? "mode" : null;
    case "cheque_in": return !d.partyId ? "party" : !d.amount ? "amount" : null;
    case "clear_cheque": return d.heardParty && !d.partyId ? "party" : !d.target ? "target" : !d.mode ? "mode" : null;
    case "mark_delivered": case "cancel_delivery": case "delete_entry":
      return d.heardParty && !d.partyId && !d.targets.length && !d.target ? "party" : !d.target ? "target" : null;
    case "create_party": return !d.partyName ? "name" : !M.kind ? "kind" : null;
    case "update_party": return !d.partyId ? "party" : [M.newName, M.kind, M.phone, M.address, M.creditDays, M.opening].every((v) => v == null) ? "fields" : null;
    case "create_item": return !M.name ? "name" : null;
    case "update_item": return !d.itemId ? "item_master" : [M.newName, M.baseRate, M.openingStock].every((v) => v == null) ? "fields" : null;
    case "stock_adjust": return !d.itemId ? "item_master" : !M.stockDelta ? "fields" : null;
    case "create_account": return !M.name ? "name" : !M.accType ? "acctype" : null;
    case "update_account": return !d.accountId ? "account_master" : M.opening == null && !M.newName ? "fields" : null;
  }
  if (isTrade(a)) {
    if ((d.mode === "credit" || d.heardParty) && !d.partyId) return "party";
    if (!d.lines.length) return "lines";
    if (d.lines.some((l) => !l.itemId)) return "item";
    if (d.lines.some((l) => !l.kg || l.rate == null)) return "lines";
    if (!d.amount) return "amount";
    if (!d.mode) return "mode";
    if (d.mode === "credit" && !d.partyId) return "party";
  }
  return null;
}

const TITLE: Record<Act, string> = {
  payment_in: "🟢 Payment RECEIVED", payment_out: "🔴 Payment PAID", expense: "🧾 Expense", cheque_in: "🏛 Cheque received (PDC)",
  clear_cheque: "🏦 Cheque cleared", sale: "📈 Sale", sale_return: "↩️ Sales RETURN", purchase: "🛒 Purchase",
  purchase_return: "↪️ Purchase RETURN", mark_delivered: "🚚 Mark delivered", cancel_delivery: "🚫 Cancel delivery",
  create_party: "➕ New party", update_party: "✏️ Update party", create_item: "➕ New item", update_item: "✏️ Update item",
  stock_adjust: "⚖️ Stock adjustment", create_account: "➕ New cash/bank account", update_account: "✏️ Update account",
  delete_entry: "🗑 DELETE entry",
};

function partyDelta(d: Draft) {
  const amt = d.amount || 0;
  switch (d.act) {
    case "payment_in": return -amt; case "payment_out": return amt;
    case "sale": return d.mode === "credit" && !d.deliveryDate ? amt : 0;
    case "sale_return": return d.mode === "credit" ? -amt : 0;
    case "purchase": return d.mode === "credit" ? -amt : 0;
    case "purchase_return": return d.mode === "credit" ? amt : 0;
  }
  return 0;
}

function summary(d: Draft, m: M) {
  const M = d.master;
  const acc = m.accounts.find((a) => a.id === d.mode);
  const party = m.parties.find((p) => p.id === d.partyId);
  const item = m.items.find((i) => i.id === d.itemId);
  const account = m.accounts.find((a) => a.id === d.accountId);
  const L: string[] = [];
  const dated = !["create_party", "update_party", "create_item", "update_item", "stock_adjust", "create_account", "update_account", "mark_delivered", "cancel_delivery", "delete_entry", "clear_cheque"].includes(d.act);
  if (dated) L.push(`📅 ${fmtDate(d.date)}`);
  if (d.act === "create_party") {
    L.push(`👤 <b>${esc(d.partyName || "name ?")}</b> — ${M.kind || "customer/supplier ?"}`);
    const ob = signedOpening(d, M.kind || null);
    L.push(`📒 Opening balance: ${ob == null ? "0" : drcr(ob)}${ob ? (ob > 0 ? " (they owe you)" : " (you owe them)") : ""}`);
    if (M.phone) L.push(`📞 ${esc(M.phone)}`); if (M.address) L.push(`📍 ${esc(M.address)}`);
    L.push(`⏱ Credit days: ${M.creditDays ?? 7}`);
    const dup = rank(m.parties, d.partyName)[0]; if (dup && dup.s >= 0.85) L.push(`⚠️ Similar party already exists: <b>${esc(dup.o.name)}</b>`);
    return L;
  }
  if (d.act === "update_party") {
    L.push(`👤 <b>${esc(d.partyId ? d.partyName : (d.partyName || "?") + " (not found)")}</b>`);
    if (M.newName) L.push(`🔤 New name: ${esc(M.newName)}`); if (M.kind) L.push(`🏷 Type: ${M.kind}`);
    if (M.phone) L.push(`📞 ${esc(M.phone)}`); if (M.address) L.push(`📍 ${esc(M.address)}`);
    if (M.creditDays != null) L.push(`⏱ Credit days: ${M.creditDays}`);
    if (M.opening != null && party) {
      const ob = signedOpening(d, M.kind || party.kind)!; const diff = ob - (party.openingBalance || 0);
      L.push(`📒 Opening: ${drcr(party.openingBalance || 0)} → <b>${drcr(ob)}</b>`);
      L.push(`⚖️ Balance: ${drcr(party.currentBalance || 0)} → <b>${drcr(r2((party.currentBalance || 0) + diff))}</b>`);
    }
    return L;
  }
  if (d.act === "create_item") {
    L.push(`📦 <b>${esc(M.name || "?")}</b>`); L.push(`💲 Base rate: ${M.baseRate != null ? inr(M.baseRate) + "/kg" : "0"}`);
    L.push(`🏗 Opening stock: ${kgf(M.openingStock || 0)}`);
    const dup = rank(m.items, M.name || "")[0]; if (dup && dup.s >= 0.85) L.push(`⚠️ Similar item exists: <b>${esc(dup.o.name)}</b>`);
    return L;
  }
  if (d.act === "update_item" || d.act === "stock_adjust") {
    L.push(`📦 <b>${esc(item?.name || (d.heardItem || "?") + " (not found)")}</b>`);
    if (M.newName) L.push(`🔤 New name: ${esc(M.newName)}`);
    if (M.baseRate != null && d.act === "update_item") L.push(`💲 Base rate: ${inr(item?.baseRate || 0)} → <b>${inr(M.baseRate)}</b>/kg`);
    if (M.openingStock != null && d.act === "update_item") L.push(`🏗 Opening stock: ${kgf(item?.openingStock || 0)} → <b>${kgf(M.openingStock)}</b>`);
    if (d.act === "stock_adjust" && M.stockDelta) L.push(`⚖️ ${M.stockDelta > 0 ? "Add" : "Reduce"} <b>${kgf(Math.abs(M.stockDelta))}</b> (adjusts opening stock ${kgf(item?.openingStock || 0)} → ${kgf((item?.openingStock || 0) + M.stockDelta)})`);
    if (d.notes) L.push(`📝 ${esc(d.notes)}`);
    return L;
  }
  if (d.act === "create_account") {
    L.push(`🏦 <b>${esc(M.name || "?")}</b> — ${M.accType || "cash/bank ?"}`); L.push(`📒 Opening balance: ${inr(M.opening || 0)}`); return L;
  }
  if (d.act === "update_account") {
    L.push(`🏦 <b>${esc(account?.name || (d.heardAccount || "?") + " (not found)")}</b>`);
    if (M.newName) L.push(`🔤 New name: ${esc(M.newName)}`);
    if (M.opening != null && account) { const diff = M.opening - (account.openingBalance || 0); L.push(`📒 Opening: ${inr(account.openingBalance || 0)} → <b>${inr(M.opening)}</b>`); L.push(`💰 Balance: ${inr(account.balance || 0)} → <b>${inr(r2((account.balance || 0) + diff))}</b>`); }
    return L;
  }
  if (d.partyId || d.partyName) L.push(`👤 ${esc(d.partyId ? d.partyName : d.partyName + " (not found)")}`);
  if (d.target) L.push(`📄 ${esc(d.target.label)}`);
  for (const l of d.lines) L.push(`📦 ${esc(l.itemName)} — ${l.kg ? kgf(l.kg) : "kg ?"} × ${l.rate != null ? inr(l.rate) : "rate ?"}${l.amount ? " = " + inr(l.amount) : ""}`);
  if (isSaleish(d.act) && d.deliveryCharge) L.push(`🚚 Delivery ${inr(d.deliveryCharge)}`);
  if (d.act === "sale" && d.deliveryDate) L.push(`🗓 Scheduled delivery ${fmtDate(d.deliveryDate)} (balance changes when marked delivered)`);
  if (d.act === "cheque_in") { L.push(`🔢 Cheque no: ${esc(d.chequeNo || "-")}`); L.push(`🗓 Clearance: ${fmtDate(d.clearanceDate)} (balances change when cleared)`); }
  if (d.amount && !["mark_delivered", "cancel_delivery", "delete_entry", "clear_cheque"].includes(d.act)) L.push(`💰 <b>${inr(d.amount)}</b>`);
  if (["payment_in", "payment_out", "expense", "clear_cheque"].includes(d.act) || isTrade(d.act))
    L.push(`🏦 ${d.mode === "credit" ? "Credit (khata)" : acc ? esc(acc.name) : "account ?"}${d.act === "sale_return" && acc ? " (refund paid)" : d.act === "purchase_return" && acc ? " (refund received)" : ""}`);
  if (d.notes) L.push(`📝 ${esc(d.notes)}`);
  const delta = partyDelta(d);
  if (party && delta) L.push(`⚖️ Balance ${drcr(party.currentBalance || 0)} → <b>${drcr(r2((party.currentBalance || 0) + delta))}</b>`);
  if (d.act === "delete_entry" && d.target) L.push(`⚠️ This removes the entry and reverses its balance effect. Cannot be undone by "undo".`);
  return L;
}

function card(d: Draft, m: M, id: number) {
  let t = `<b>${TITLE[d.act]}</b>  <i>#${id}</i>\n` + summary(d, m).join("\n") + "\n";
  if (d.heard) t += `\n🎙 <i>${esc(d.heard)}</i>\n`;
  const need = missing(d); const kb: any[][] = [];
  const two = (row: any[]) => { for (let k = 0; k < row.length; k += 2) kb.push(row.slice(k, k + 2)); };
  if (need === "party") {
    t += `\n❓ <b>Which party?</b>`;
    d.partyCandidates.forEach((pid) => { const p = m.parties.find((x) => x.id === pid); if (p) kb.push([{ text: `👤 ${p.name}`, callback_data: `p:${id}:${pid}` }]); });
    if (d.partyName && !["mark_delivered", "cancel_delivery", "delete_entry", "clear_cheque", "update_party"].includes(d.act)) kb.push([{ text: `➕ Create new party "${d.partyName.slice(0, 30)}"`, callback_data: `n:${id}` }]);
    if (!kb.length) t += `\nNo match. Send again with the exact name.`;
  } else if (need === "item") {
    t += `\n❓ <b>Which item?</b>`; const li = d.lines.findIndex((l) => !l.itemId);
    two(m.items.slice(0, 10).map((it) => ({ text: `📦 ${it.name}`, callback_data: `i:${id}:${li}:${it.id}` })));
  } else if (need === "item_master") {
    t += `\n❓ <b>Which item?</b>`; two(m.items.slice(0, 10).map((it) => ({ text: `📦 ${it.name}`, callback_data: `m:${id}:${it.id}` })));
  } else if (need === "account_master") {
    t += `\n❓ <b>Which account?</b>`; two(m.accounts.map((a) => ({ text: `🏦 ${a.name}`, callback_data: `b:${id}:${a.id}` })));
  } else if (need === "mode") {
    t += `\n❓ <b>${isTrade(d.act) ? "Cash / bank / credit?" : "Which account?"}</b>`;
    const row = m.accounts.filter((a) => d.act !== "clear_cheque" || a.type === "bank" || m.accounts.every((x) => x.type !== "bank"))
      .map((a) => ({ text: `🏦 ${a.name}`, callback_data: `a:${id}:${a.id}` }));
    if (isTrade(d.act) && (d.partyId || d.partyName)) row.push({ text: "📒 Credit (khata)", callback_data: `a:${id}:credit` });
    two(row);
  } else if (need === "kind") {
    t += `\n❓ <b>Customer or supplier?</b>`; kb.push([{ text: "🧑‍🍳 Customer", callback_data: `k:${id}:customer` }, { text: "🚛 Supplier", callback_data: `k:${id}:supplier` }]);
  } else if (need === "acctype") {
    t += `\n❓ <b>Cash or bank?</b>`; kb.push([{ text: "💵 Cash", callback_data: `k:${id}:cash` }, { text: "🏦 Bank", callback_data: `k:${id}:bank` }]);
  } else if (need === "target") {
    if (!d.targets.length) t += `\n⚠️ <b>Nothing matching found.</b>`;
    else { t += `\n❓ <b>Which one?</b>`; d.targets.forEach((x, k) => kb.push([{ text: x.label.slice(0, 60), callback_data: `t:${id}:${k}` }])); }
  } else if (need) {
    const msg: Record<string, string> = {
      amount: "Amount missing. Send again with the amount.", lines: `Kg or rate missing. Send again, e.g. "sold 500 kg steam coal at 14 to ABC Bakers on credit".`,
      name: "Name missing. Send again with the name.", fields: "Tell me what to change (opening balance, rate, phone, credit days…).",
    };
    t += `\n⚠️ <b>${msg[need] || "Some detail is missing."}</b>`;
  } else kb.push([{ text: d.act === "delete_entry" ? "🗑 Yes, delete it" : "✅ Confirm & Post", callback_data: `c:${id}` }]);
  kb.push([{ text: "❌ Cancel", callback_data: `x:${id}` }]);
  return { text: t, markup: { inline_keyboard: kb } };
}

// ---------- posting (mirrors src/lib/store.ts) ----------
async function postBillEffects(b: any, m: M) {
  if (b.saleType === "credit_delivery" && b.partyId) {
    const p = m.parties.find((x) => x.id === b.partyId) || (await must(db.from("parties").select("*").eq("id", b.partyId).single(), "Party"));
    const rates = { ...((p as any)?.customRates || {}) }; if (b.total > 0) b.lines.forEach((l: any) => { if (l.itemId) rates[l.itemId] = l.rate; });
    await adjParty(b.partyId, b.total, b.total > 0 ? { lastOrderDate: b.date, customRates: rates } : {});
  } else if (b.accountId && (b.saleType === "walkin" || b.saleType === "prepaid_delivery")) await adjAccount(b.accountId, b.total);
}

async function post(d: Draft, m: M): Promise<any> {
  const note = (d.notes ? d.notes + " · " : "") + "via Telegram";
  const M = d.master;
  switch (d.act) {
    case "payment_in": case "payment_out": case "expense": {
      const isIn = d.act === "payment_in";
      const row = { date: d.date, type: d.act, partyId: d.act === "expense" ? null : d.partyId, partyName: d.act === "expense" ? "" : d.partyName, accountId: d.mode, amount: d.amount, notes: note };
      const r: any = await must(db.from("money").insert(row).select().single(), "Save entry");
      await adjAccount(d.mode!, isIn ? d.amount! : -d.amount!);
      if (row.partyId) await adjParty(row.partyId, isIn ? -d.amount! : d.amount!);
      return { kind: "money", ids: [r.id] };
    }
    case "cheque_in": {
      const r: any = await must(db.from("money").insert({ date: d.date, type: "pdc_in", status: "pending", clearanceDate: d.clearanceDate, chequeNumber: d.chequeNo,
        partyId: d.partyId, partyName: d.partyName, accountId: null, amount: d.amount, notes: note }).select().single(), "Save cheque");
      return { kind: "money", ids: [r.id] };
    }
    case "clear_cheque": {
      const c: any = await must(db.from("money").select("*").eq("id", d.target!.id).single(), "Cheque");
      if (c.status !== "pending") throw new Error("Cheque is already cleared.");
      await must(db.from("money").update({ status: "cleared", accountId: d.mode }).eq("id", c.id), "Clear cheque");
      await adjAccount(d.mode!, c.amount); if (c.partyId) await adjParty(c.partyId, -c.amount);
      return { kind: "cheque_clear", id: c.id, accountId: d.mode, partyId: c.partyId, amount: c.amount };
    }
    case "purchase": case "purchase_return": {
      const credit = d.mode === "credit", sign = d.act === "purchase_return" ? -1 : 1, ids: string[] = [];
      for (const l of d.lines) {
        const total = r2(sign * l.kg * (l.rate || 0));
        const r: any = await must(db.from("purchases").insert({ date: d.date, partyId: d.partyId || "", supplierName: d.partyName || "Cash supplier",
          itemId: l.itemId, itemName: l.itemName, kg: sign * l.kg, rate: l.rate, total, accountId: credit ? null : d.mode, paymentMethod: credit ? "credit" : "cash" }).select().single(), "Save purchase");
        ids.push(r.id);
        if (!credit) await adjAccount(d.mode!, -total); else if (d.partyId) await adjParty(d.partyId, -total);
      }
      return { kind: "purchase", ids };
    }
    case "sale": case "sale_return": {
      const credit = d.mode === "credit", ret = d.act === "sale_return", sign = ret ? -1 : 1;
      const scheduled = !ret && !!d.deliveryDate;
      const lines = d.lines.map((l) => ({ itemId: l.itemId, itemName: l.itemName, kg: sign * l.kg, rate: l.rate, amount: r2(sign * l.kg * (l.rate || 0)) }));
      const total = r2(lines.reduce((s, l) => s + l.amount, 0) + sign * d.deliveryCharge);
      const bill = { date: d.date, saleType: credit ? "credit_delivery" : scheduled ? "prepaid_delivery" : "walkin", partyId: d.partyId || null,
        customerName: d.partyName || (ret ? "Walk-in return" : "Walk-in"), phone: "", address: "", deliveryDate: d.deliveryDate || "", deliveryTime: "",
        deliveryCharge: sign * d.deliveryCharge, lines, total, accountId: credit ? null : d.mode, paymentMethod: credit ? "credit" : "cash",
        deliveryStatus: scheduled ? "scheduled" : credit ? "delivered" : null, isPosted: !scheduled, notes: (ret ? "SALES RETURN · " : "") + note };
      const r: any = await must(db.from("bills").insert(bill).select().single(), "Save bill");
      if (!scheduled) await postBillEffects(bill, m);
      return { kind: "bill", ids: [r.id] };
    }
    case "mark_delivered": {
      const b: any = await must(db.from("bills").select("*").eq("id", d.target!.id).single(), "Bill");
      if (b.deliveryStatus !== "scheduled") throw new Error("This order is not pending any more.");
      if (!b.isPosted) await postBillEffects(b, m);
      await must(db.from("bills").update({ deliveryStatus: "delivered", isPosted: true }).eq("id", b.id), "Update bill");
      return { kind: "delivered", id: b.id, wasPosted: !!b.isPosted };
    }
    case "cancel_delivery": {
      await must(db.from("bills").update({ deliveryStatus: "canceled" }).eq("id", d.target!.id), "Cancel");
      return { kind: "canceled", id: d.target!.id };
    }
    case "delete_entry": {
      await reverse({ kind: d.target!.table === "bills" ? "bill" : d.target!.table === "purchases" ? "purchase" : "money", ids: [d.target!.id] });
      return { kind: "deleted" };
    }
    case "create_party": {
      const ob = signedOpening(d, M.kind!) || 0;
      const r: any = await must(db.from("parties").insert({ name: d.partyName, kind: M.kind, phone: M.phone || "", address: M.address || "", creditDays: M.creditDays ?? 7,
        openingBalance: ob, currentBalance: ob, customRates: {}, lastOrderDate: "", chase: false }).select().single(), "Create party");
      return { kind: "party_create", id: r.id };
    }
    case "update_party": {
      const old: any = await must(db.from("parties").select("*").eq("id", d.partyId!).single(), "Party");
      const upd: any = {}; const before: any = {};
      const set = (k: string, v: any) => { if (v != null) { upd[k] = v; before[k] = old[k]; } };
      set("name", M.newName); set("kind", M.kind); set("phone", M.phone); set("address", M.address); set("creditDays", M.creditDays);
      let diff = 0; const ob = signedOpening(d, M.kind || old.kind);
      if (ob != null) { set("openingBalance", ob); diff = r2(ob - (old.openingBalance || 0)); upd.currentBalance = r2((old.currentBalance || 0) + diff); }
      await must(db.from("parties").update(upd).eq("id", old.id), "Update party");
      return { kind: "party_update", id: old.id, before, diff };
    }
    case "create_item": {
      const r: any = await must(db.from("items").insert({ name: M.name, baseRate: M.baseRate || 0, openingStock: M.openingStock || 0 }).select().single(), "Create item");
      return { kind: "item_create", id: r.id };
    }
    case "update_item": case "stock_adjust": {
      const old: any = await must(db.from("items").select("*").eq("id", d.itemId!).single(), "Item");
      const upd: any = {};
      if (d.act === "stock_adjust") upd.openingStock = r2((old.openingStock || 0) + (M.stockDelta || 0));
      else { if (M.newName) upd.name = M.newName; if (M.baseRate != null) upd.baseRate = M.baseRate; if (M.openingStock != null) upd.openingStock = M.openingStock; }
      await must(db.from("items").update(upd).eq("id", old.id), "Update item");
      return { kind: "item_update", id: old.id, before: { name: old.name, baseRate: old.baseRate, openingStock: old.openingStock } };
    }
    case "create_account": {
      const ob = M.opening || 0;
      const r: any = await must(db.from("accounts").insert({ name: M.name, type: M.accType, openingBalance: ob, balance: ob }).select().single(), "Create account");
      return { kind: "account_create", id: r.id };
    }
    case "update_account": {
      const old: any = await must(db.from("accounts").select("*").eq("id", d.accountId!).single(), "Account");
      const upd: any = {}; let diff = 0;
      if (M.newName) upd.name = M.newName;
      if (M.opening != null) { diff = r2(M.opening - (old.openingBalance || 0)); upd.openingBalance = M.opening; upd.balance = r2((old.balance || 0) + diff); }
      await must(db.from("accounts").update(upd).eq("id", old.id), "Update account");
      return { kind: "account_update", id: old.id, oldName: old.name, oldOpening: old.openingBalance, diff };
    }
  }
  throw new Error("Unsupported action");
}

async function reverse(res: any) {
  switch (res.kind) {
    case "money": for (const id of res.ids) {
      const { data: o } = await db.from("money").select("*").eq("id", id).single(); if (!o) continue;
      if (!(o.type === "pdc_in" && o.status === "pending")) {
        const isIn = o.type === "payment_in" || o.type === "pdc_in";
        if (o.accountId) await adjAccount(o.accountId, isIn ? -o.amount : o.amount);
        if (o.partyId) await adjParty(o.partyId, isIn ? o.amount : -o.amount);
      }
      await db.from("money").delete().eq("id", id);
    } return;
    case "purchase": for (const id of res.ids) {
      const { data: o } = await db.from("purchases").select("*").eq("id", id).single(); if (!o) continue;
      if (o.accountId) await adjAccount(o.accountId, o.total); else if (o.partyId) await adjParty(o.partyId, o.total);
      await db.from("purchases").delete().eq("id", id);
    } return;
    case "bill": for (const id of res.ids) {
      const { data: o } = await db.from("bills").select("*").eq("id", id).single(); if (!o) continue;
      if (o.isPosted) {
        if (o.accountId && (o.saleType === "walkin" || o.saleType === "prepaid_delivery")) await adjAccount(o.accountId, -o.total);
        if (o.partyId && o.saleType === "credit_delivery") await adjParty(o.partyId, -o.total);
      }
      await db.from("bills").delete().eq("id", id);
    } return;
    case "cheque_clear":
      await db.from("money").update({ status: "pending", accountId: null }).eq("id", res.id);
      await adjAccount(res.accountId, -res.amount); if (res.partyId) await adjParty(res.partyId, res.amount); return;
    case "delivered": {
      const { data: b } = await db.from("bills").select("*").eq("id", res.id).single(); if (!b) return;
      if (!res.wasPosted) {
        if (b.saleType === "credit_delivery" && b.partyId) await adjParty(b.partyId, -b.total);
        else if (b.accountId) await adjAccount(b.accountId, -b.total);
      }
      await db.from("bills").update({ deliveryStatus: "scheduled", isPosted: res.wasPosted }).eq("id", res.id); return;
    }
    case "canceled": await db.from("bills").update({ deliveryStatus: "scheduled" }).eq("id", res.id); return;
    case "party_create": {
      const used = await Promise.all([db.from("money").select("id").eq("partyId", res.id).limit(1), db.from("bills").select("id").eq("partyId", res.id).limit(1), db.from("purchases").select("id").eq("partyId", res.id).limit(1)]);
      if (used.some((u) => (u.data || []).length)) throw new Error("Party already has entries — delete it from the app instead.");
      await db.from("parties").delete().eq("id", res.id); return;
    }
    case "party_update": {
      const { data: p } = await db.from("parties").select("currentBalance").eq("id", res.id).single();
      await db.from("parties").update({ ...res.before, ...(res.diff ? { currentBalance: r2((p?.currentBalance || 0) - res.diff) } : {}) }).eq("id", res.id); return;
    }
    case "item_create": await db.from("items").delete().eq("id", res.id); return;
    case "item_update": await db.from("items").update(res.before).eq("id", res.id); return;
    case "account_create": await db.from("accounts").delete().eq("id", res.id); return;
    case "account_update": {
      const { data: a } = await db.from("accounts").select("balance").eq("id", res.id).single();
      await db.from("accounts").update({ name: res.oldName, openingBalance: res.oldOpening, balance: r2((a?.balance || 0) - res.diff) }).eq("id", res.id); return;
    }
    case "deleted": throw new Error("A deleted entry cannot be restored by undo. Re-enter it.");
  }
}

// ---------- queries (instant, no confirmation) ----------
async function stockMap(m: M) {
  const [{ data: pur }, { data: bills }] = await Promise.all([db.from("purchases").select("itemId,kg"), db.from("bills").select("isPosted,lines")]);
  const s = new Map<string, number>(); m.items.forEach((i) => s.set(i.id, i.openingStock || 0));
  (pur || []).forEach((p: any) => s.set(p.itemId, (s.get(p.itemId) || 0) + p.kg));
  (bills || []).forEach((b: any) => { if (b.isPosted) (b.lines || []).forEach((l: any) => s.set(l.itemId, (s.get(l.itemId) || 0) - l.kg)); });
  return s;
}
async function runQuery(q: any, m: M): Promise<string> {
  const kind = q.query || "balance";
  if (kind === "stock") {
    const s = await stockMap(m);
    return `<b>📦 Stock now</b>\n` + (m.items.map((i) => `• ${esc(i.name)}: <b>${kgf(r2(s.get(i.id) || 0))}</b>${(s.get(i.id) || 0) <= 500 ? " ⚠️" : ""}`).join("\n") || "No items yet.");
  }
  if (kind === "pending_deliveries") {
    const { data } = await db.from("bills").select("*").eq("deliveryStatus", "scheduled");
    const rows = (data || []).sort((a: any, b: any) => (a.deliveryDate || a.date).localeCompare(b.deliveryDate || b.date));
    return `<b>🚚 Pending deliveries (${rows.length})</b>\n` + (rows.map((b: any) => `• ${esc(b.customerName)} · ${fmtDate(b.deliveryDate || b.date)} ${esc(b.deliveryTime || "")} · ${b.lines.map((l: any) => `${esc(l.itemName)} ${kgf(l.kg)}`).join(", ")} · ${inr(b.total)}`).join("\n") || "None.");
  }
  if (kind === "cheques") {
    const { data } = await db.from("money").select("*").eq("type", "pdc_in").eq("status", "pending");
    const rows = (data || []).sort((a: any, b: any) => (a.clearanceDate || "").localeCompare(b.clearanceDate || ""));
    return `<b>🏛 Pending cheques (${rows.length})</b>\n` + (rows.map((x: any) => `• ${esc(x.partyName)} · #${esc(x.chequeNumber || "-")} · ${fmtDate(x.clearanceDate)} · ${inr(x.amount)}${x.clearanceDate <= istToday() ? " ⏰ due" : ""}`).join("\n") || "None.");
  }
  if (kind === "day_report") {
    const day = isDate(q.date) ? q.date : istToday();
    const [{ data: bills }, { data: pur }, { data: money }] = await Promise.all([
      db.from("bills").select("*").eq("date", day).eq("isPosted", true), db.from("purchases").select("*").eq("date", day), db.from("money").select("*").eq("date", day)]);
    const sale = (bills || []).reduce((s: number, b: any) => s + b.total, 0), cashSale = (bills || []).filter((b: any) => b.saleType !== "credit_delivery").reduce((s: number, b: any) => s + b.total, 0);
    const kgS = (bills || []).reduce((s: number, b: any) => s + b.lines.reduce((x: number, l: any) => x + l.kg, 0), 0);
    const purT = (pur || []).reduce((s: number, p: any) => s + p.total, 0), kgP = (pur || []).reduce((s: number, p: any) => s + p.kg, 0);
    const sum = (t: string) => (money || []).filter((x: any) => x.type === t).reduce((s: number, x: any) => s + x.amount, 0);
    return `<b>📊 ${fmtDate(day)}</b>\n📈 Sales: ${inr(sale)} (${kgf(kgS)}) · cash/bank ${inr(cashSale)}\n🛒 Purchases: ${inr(purT)} (${kgf(kgP)})\n🟢 Received: ${inr(sum("payment_in"))}\n🔴 Paid: ${inr(sum("payment_out"))}\n🧾 Expenses: ${inr(sum("expense"))}\n🏛 Cheques recd: ${inr(sum("pdc_in"))}\n\n` +
      `<b>🏦 Balances now</b>\n` + m.accounts.map((a) => `• ${esc(a.name)}: ${inr(a.balance || 0)}`).join("\n");
  }
  if (kind === "statement" && q.party) {
    const { hit, cands } = pickOne(m.parties, q.party, 0.6);
    const p: any = hit || (cands[0] && similarity(cands[0].name, q.party) >= 0.6 ? cands[0] : null);
    if (!p) return `No party like "${esc(q.party)}".`;
    const [{ data: bills }, { data: pur }, { data: money }] = await Promise.all([
      db.from("bills").select("*").eq("partyId", p.id), db.from("purchases").select("*").eq("partyId", p.id), db.from("money").select("*").eq("partyId", p.id)]);
    const ev: { date: string; t: string; d: number }[] = [];
    (bills || []).forEach((b: any) => { if (b.isPosted && b.saleType === "credit_delivery") ev.push({ date: b.date, t: `${b.total < 0 ? "Return" : "Sale"} ${b.lines.map((l: any) => kgf(Math.abs(l.kg))).join("+")}`, d: b.total }); });
    (pur || []).forEach((x: any) => { if (!x.accountId) ev.push({ date: x.date, t: `${x.total < 0 ? "Pur. return" : "Purchase"} ${kgf(Math.abs(x.kg))}`, d: -x.total }); });
    (money || []).forEach((x: any) => {
      if (x.type === "payment_in") ev.push({ date: x.date, t: "Received", d: -x.amount });
      else if (x.type === "payment_out") ev.push({ date: x.date, t: "Paid", d: x.amount });
      else if (x.type === "pdc_in" && x.status === "cleared") ev.push({ date: x.date, t: `Cheque ${x.chequeNumber || ""}`, d: -x.amount });
    });
    ev.sort((a, b) => a.date.localeCompare(b.date));
    let bal = p.currentBalance || 0; const lines: string[] = [];
    for (let k = ev.length - 1; k >= 0 && lines.length < 15; k--) { lines.unshift(`${fmtDate(ev[k].date)} · ${esc(ev[k].t)} · ${ev[k].d > 0 ? "+" : ""}${inr(ev[k].d)} → ${drcr(r2(bal))}`); bal -= ev[k].d; }
    return `<b>📒 ${esc(p.name)}</b> (${p.kind})\nOpening: ${drcr(p.openingBalance || 0)}\n\n${lines.join("\n") || "No entries yet."}\n\n<b>Balance: ${drcr(p.currentBalance || 0)}</b>`;
  }
  if (q.party) {
    const r = rank(m.parties, q.party).filter((x) => x.s >= 0.5).slice(0, 3);
    if (!r.length) return `No party like "${esc(q.party)}".`;
    return r.map((x) => `👤 <b>${esc(x.o.name)}</b>: ${drcr(x.o.currentBalance || 0)}`).join("\n");
  }
  let t = `<b>🏦 Cash & Bank</b>\n` + m.accounts.map((a) => `• ${esc(a.name)}: ${inr(a.balance || 0)}`).join("\n");
  const rec = m.parties.filter((p) => (p.currentBalance || 0) > 0).sort((a, b) => b.currentBalance - a.currentBalance);
  const pay = m.parties.filter((p) => (p.currentBalance || 0) < 0).sort((a, b) => a.currentBalance - b.currentBalance);
  const n = kind === "parties" ? 50 : 10;
  t += `\n\n<b>📥 To receive: ${inr(rec.reduce((s, p) => s + p.currentBalance, 0))}</b>\n` + rec.slice(0, n).map((p) => `• ${esc(p.name)}: ${inr(p.currentBalance)}`).join("\n");
  t += `\n\n<b>📤 To pay: ${inr(-pay.reduce((s, p) => s + p.currentBalance, 0))}</b>\n` + pay.slice(0, n).map((p) => `• ${esc(p.name)}: ${inr(-p.currentBalance)}`).join("\n");
  if (kind === "parties") { const zero = m.parties.filter((p) => !p.currentBalance); if (zero.length) t += `\n\n<b>Settled:</b> ${zero.map((p) => esc(p.name)).join(", ")}`; }
  return t;
}

// ---------- handlers ----------
const HELP = `<b>UCD Bot</b> — speak or type. Entries show a draft first; tap ✅ to post.

<b>Money</b>: "Received 50000 from ABC Bakers cash" · "Paid 1 lakh to Sharma Coal by bank" · "Diesel 2000 cash" · "Cheque 25000 from ABC no 123456 date 20 Nov" · "ABC cheque cleared in HDFC"
<b>Sales</b>: "Sold 5 quintal steam coal to ABC Bakers at 14 credit" · "Walk-in 200 kg at 15 cash" · "Deliver 1 ton to ABC tomorrow on credit" · "ABC delivery done" · "Cancel ABC delivery"
<b>Purchase</b>: "Bought 10 ton from Sharma Coal at 11 on credit"
<b>Returns</b>: "ABC returned 50 kg steam coal" · "Returned 2 quintal to Sharma Coal"
<b>Setup</b>: "New customer Gill Dhaba opening 12000 baki, phone 98140xxxxx" · "Sharma Coal opening balance 2 lakh dena" · "New item hard coke rate 30 opening stock 5 ton" · "Steam coal rate 15" · "Steam coal shortage 40 kg" · "New bank account PNB opening 50000"
<b>Fix</b>: "undo" · "Delete ABC payment 5000"
<b>Ask</b>: "ABC balance" · "ABC khata" · "stock" · "pending deliveries" · "cheques" · "today report" · "all parties"

Many entries in one voice note are fine (e.g. a list of opening balances).`;

async function newDraftRow(chat: any, d: Draft, source: string) {
  const { data, error } = await db.from("tg_drafts").insert({ chat_id: String(chat), status: "pending", draft: d, source }).select("id").single();
  if (error) throw new Error("tg_drafts table missing? Run supabase/telegram-bot.sql once. (" + error.message + ")");
  return data.id as number;
}

async function handleUndo(chat: any) {
  const { data } = await db.from("tg_drafts").select("*").eq("chat_id", String(chat)).eq("status", "done").order("id", { ascending: false }).limit(1);
  const last = data?.[0]; if (!last) return send(chat, "Nothing to undo — no Telegram entry has been posted yet.");
  const d = last.draft as Draft;
  const m = await loadMasters();
  return send(chat, `↩️ <b>Undo this?</b>\n\n<b>${TITLE[d.act]}</b> #${last.id}\n${summary(d, m).filter((l) => !l.includes("→") && !l.startsWith("⚠️")).join("\n")}`,
    { inline_keyboard: [[{ text: "↩️ Yes, undo it", callback_data: `u:${last.id}` }], [{ text: "Keep it", callback_data: `kp:${last.id}` }]] });
}

async function onMessage(msg: any) {
  const chat = msg.chat.id;
  const text: string = msg.text || msg.caption || "";
  if (/^\/(start|help)/i.test(text)) return send(chat, HELP + `\n\nYour chat id: <code>${chat}</code>`);
  const quick: Record<string, string> = { "/stock": "stock", "/balance": "balance", "/today": "day_report", "/pending": "pending_deliveries", "/cheques": "cheques", "/parties": "parties" };
  const qk = quick[text.trim().split(/[\s@]/)[0].toLowerCase()];
  if (qk) return send(chat, await runQuery({ query: qk }, await loadMasters()));
  if (/^\/undo/i.test(text)) return handleUndo(chat);

  const voice = msg.voice || msg.audio || msg.video_note || (msg.document?.mime_type?.startsWith("audio/") ? msg.document : null);
  if (!text && !voice) return send(chat, "Send a voice note or type. /help for examples.");
  await tg("sendChatAction", { chat_id: chat, action: "typing" });
  const m = await loadMasters();

  let input: any = { text: text || undefined };
  if (voice) {
    if ((voice.file_size || 0) > 18 * 1024 * 1024) return send(chat, "Voice note too long. Keep it under 3 minutes.");
    const f: any = await tg("getFile", { file_id: voice.file_id }); const path = f?.result?.file_path;
    if (!path) return send(chat, "Could not download the voice note. Please try again.");
    const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`)).arrayBuffer());
    input = { text: text || undefined, audioB64: buf.toString("base64"), mime: msg.video_note ? "video/mp4" : voice.mime_type || "audio/ogg" };
  }

  const ai = await understand(input, m);
  const heard = ai.heard || "";
  const actions: any[] = ai.actions || [];
  const entries: Draft[] = [];
  for (const a of actions) {
    if (a.type === "help") { await send(chat, HELP); continue; }
    if (a.type === "undo") { await handleUndo(chat); continue; }
    if (a.type === "query") { await send(chat, await runQuery(a, m)); continue; }
    if ((ENTRY_ACTS as readonly string[]).includes(a.type)) { const d = buildDraft(a, heard, m); await findTargets(d); entries.push(d); }
  }
  if (!actions.length || (!entries.length && actions.every((a) => a.type === "unknown")))
    return send(chat, `🤔 I did not understand${heard ? `: <i>${esc(heard)}</i>` : ""}.\n\n/help for examples.`);
  const src = voice ? "voice" : "text";

  if (entries.length === 1) {
    const id = await newDraftRow(chat, entries[0], src); const c = card(entries[0], m, id);
    await send(chat, c.text, c.markup); return;
  }
  if (entries.length > 1) {
    entries.forEach((d) => (d.heard = ""));
    const ids: number[] = []; for (const d of entries) ids.push(await newDraftRow(chat, d, src));
    const bid = await newDraftRow(chat, { act: "batch", children: ids, heard } as any, src);
    const c = await batchCard(bid, m); await send(chat, c.text, c.markup);
  }
}

async function batchCard(bid: number, m: M) {
  const { data: b } = await db.from("tg_drafts").select("*").eq("id", bid).single();
  const ids: number[] = b.draft.children;
  const { data: kids } = await db.from("tg_drafts").select("*").in("id", ids);
  const rows = ids.map((id) => (kids || []).find((k: any) => k.id === id)).filter(Boolean);
  let t = `<b>📋 ${rows.length} entries</b>  <i>#${bid}</i>\n`; const kb: any[][] = []; let ready = 0;
  rows.forEach((r: any, k: number) => {
    const d = r.draft as Draft; const need = r.status === "pending" ? missing(d) : null;
    const head = summary(d, m).filter((l) => !l.startsWith("📅") && !l.startsWith("⚠️ This")).slice(0, 3).join(" · ").replace(/\n/g, " ");
    const st = r.status === "done" ? "✅" : r.status === "cancelled" ? "❌" : r.status === "failed" ? "⚠️" : need ? "❓" : "🟡";
    t += `\n${st} ${k + 1}. <b>${TITLE[d.act]}</b> · ${head}`;
    if (r.status === "pending" && !need) ready++;
    if (r.status === "pending" && need) kb.push([{ text: `🔧 Fix ${k + 1} (${need})`, callback_data: `f:${r.id}` }]);
  });
  if (b.draft.heard) t += `\n\n🎙 <i>${esc(b.draft.heard)}</i>`;
  t += `\n\n🟡 ready  ❓ needs info  ✅ posted`;
  if (ready) kb.unshift([{ text: `✅ Post ${ready} ready entr${ready > 1 ? "ies" : "y"}`, callback_data: `c:${bid}` }]);
  kb.push([{ text: "❌ Cancel all pending", callback_data: `x:${bid}` }, { text: "🔄 Refresh", callback_data: `r:${bid}` }]);
  return { text: t, markup: { inline_keyboard: kb } };
}

async function confirmOne(row: any, m: M): Promise<{ ok: boolean; text: string }> {
  const d = row.draft as Draft;
  if (missing(d)) return { ok: false, text: "needs info" };
  const { data: lock } = await db.from("tg_drafts").update({ status: "posting" }).eq("id", row.id).eq("status", "pending").select("id");
  if (!lock?.length) return { ok: false, text: "already handled" };
  try { const result = await post(d, m); await db.from("tg_drafts").update({ status: "done", result }).eq("id", row.id); return { ok: true, text: "posted" }; }
  catch (e: any) { await db.from("tg_drafts").update({ status: "failed", result: { error: e.message } }).eq("id", row.id); return { ok: false, text: e.message }; }
}

// Next day banks are open: skips Sundays and 2nd / 4th Saturdays (other bank holidays: just tap "Not yet" again).
function nextBankDay(fromIso: string): string {
  const d = new Date(fromIso + "T00:00:00Z");
  for (let k = 0; k < 10; k++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(), nth = Math.ceil(d.getUTCDate() / 7);
    if (dow === 0) continue;
    if (dow === 6 && (nth === 2 || nth === 4)) continue;
    break;
  }
  return d.toISOString().slice(0, 10);
}
const longDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// Buttons under the EOD report's "Cheque due" messages (sent by api/report.ts)
async function onChequeCheck(chat: any, mid: number, op: string, moneyId: string, idx: string) {
  const { data: c } = await db.from("money").select("*").eq("id", moneyId).single();
  if (!c || c.type !== "pdc_in") return edit(chat, mid, "This cheque entry no longer exists.");
  const head = `🏛 ${esc(c.partyName)} · ${inr(c.amount)} · chq ${esc(c.chequeNumber || "-")}`;
  if (c.status !== "pending") return edit(chat, mid, `${head}\n✅ Already marked cleared.`);

  if (op === "qn") {
    const next = nextBankDay(istToday());
    await must(db.from("money").update({ clearanceDate: next }).eq("id", moneyId).eq("status", "pending"), "Reschedule");
    return edit(chat, mid, `${head}\n📅 Not presented. Moved to <b>${longDate(next)}</b> — it will be in that morning's report and I will ask again that evening.`);
  }

  const { data: accs } = await db.from("accounts").select("*");
  const sorted = (accs || []).slice().sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
  const banks = sorted.filter((a: any) => a.type === "bank");
  const acc = (banks.length ? banks : sorted)[Number(idx)];
  if (!acc) return edit(chat, mid, `${head}\n⚠️ That bank account was not found. Say "${esc(c.partyName)} cheque cleared in <bank>" instead.`);

  const { data: lock } = await db.from("money").update({ status: "cleared", accountId: acc.id }).eq("id", moneyId).eq("status", "pending").select("id");
  if (!lock?.length) return edit(chat, mid, `${head}\n✅ Already marked cleared.`);
  await adjAccount(acc.id, c.amount);
  if (c.partyId) await adjParty(c.partyId, -c.amount);

  // keep a record so "undo" can reverse it
  const draft = {
    act: "clear_cheque", date: istToday(), amount: c.amount, partyId: c.partyId || null, partyName: c.partyName || "", heardParty: null, partyCandidates: [],
    mode: acc.id, lines: [], deliveryCharge: 0, deliveryDate: null, notes: "", heard: "", chequeNo: c.chequeNumber || "", clearanceDate: c.clearanceDate || "",
    itemId: null, heardItem: null, accountId: null, heardAccount: null, entryType: null,
    target: { table: "money", id: c.id, label: `${c.partyName} · chq ${c.chequeNumber || "-"} · ${inr(c.amount)}` }, targets: [], master: {},
  };
  await db.from("tg_drafts").insert({ chat_id: String(chat), status: "done", source: "eod", draft, result: { kind: "cheque_clear", id: c.id, accountId: acc.id, partyId: c.partyId || null, amount: c.amount } });

  let after = "";
  if (c.partyId) { const { data: p } = await db.from("parties").select("name,currentBalance").eq("id", c.partyId).single(); if (p) after += `\n⚖️ ${esc(p.name)}: <b>${drcr(p.currentBalance || 0)}</b>`; }
  const { data: a2 } = await db.from("accounts").select("name,balance").eq("id", acc.id).single();
  if (a2) after += `\n🏦 ${esc(a2.name)}: ${inr(a2.balance || 0)}`;
  return edit(chat, mid, `${head}\n✅ <b>Cleared into ${esc(acc.name)}</b>${after}\n\nSay <i>undo</i> to reverse.`);
}

async function onCallback(cq: any) {
  const chat = cq.message?.chat?.id, mid = cq.message?.message_id;
  const [op, idStr, a1, a2] = String(cq.data || "").split(":"); const id = Number(idStr);
  await tg("answerCallbackQuery", { callback_query_id: cq.id });
  if (op === "qb" || op === "qn") return onChequeCheck(chat, mid, op, idStr, a1);
  const { data: row } = await db.from("tg_drafts").select("*").eq("id", id).single();
  if (!row || row.chat_id !== String(chat)) return edit(chat, mid, "This draft no longer exists.");

  if (op === "kp") return edit(chat, mid, `👍 Kept #${id}.`);
  if (op === "u") {
    const { data: lock } = await db.from("tg_drafts").update({ status: "undoing" }).eq("id", id).eq("status", "done").select("id");
    if (!lock?.length) return edit(chat, mid, `#${id} was already undone.`);
    try { await reverse(row.result); } catch (e: any) { await db.from("tg_drafts").update({ status: "done" }).eq("id", id); return edit(chat, mid, `⚠️ Undo failed: ${esc(e.message)}`); }
    await db.from("tg_drafts").update({ status: "undone" }).eq("id", id);
    return edit(chat, mid, `↩️ #${id} reversed. Ledger and balances restored.`);
  }

  const m = await loadMasters();
  if (row.draft?.act === "batch") {
    const ids: number[] = row.draft.children;
    if (op === "c") {
      const { data: kids } = await db.from("tg_drafts").select("*").in("id", ids);
      let ok = 0; const errs: string[] = [];
      for (const k of (kids || []).sort((a: any, b: any) => a.id - b.id)) {
        if (k.status !== "pending" || missing(k.draft)) continue;
        const r = await confirmOne(k, m); if (r.ok) ok++; else errs.push(`#${k.id}: ${r.text}`);
      }
      const c = await batchCard(id, m);
      return edit(chat, mid, `✅ Posted ${ok}.${errs.length ? "\n⚠️ " + esc(errs.join("\n⚠️ ")) : ""}\n\n` + c.text, c.markup);
    }
    if (op === "x") { for (const cid of ids) await db.from("tg_drafts").update({ status: "cancelled" }).eq("id", cid).eq("status", "pending"); const c = await batchCard(id, m); return edit(chat, mid, c.text, { inline_keyboard: [] }); }
    const c = await batchCard(id, m); return edit(chat, mid, c.text, c.markup);
  }
  if (op === "f") { const c = card(row.draft, m, id); const s: any = await send(chat, c.text, c.markup); return s; }
  if (row.status !== "pending") return edit(chat, mid, `#${id} is already ${row.status}.`);
  const d = row.draft as Draft;

  if (op === "x") { await db.from("tg_drafts").update({ status: "cancelled" }).eq("id", id).eq("status", "pending"); return edit(chat, mid, `❌ Cancelled #${id}. Nothing was posted.`); }

  if (["p", "n", "a", "i", "m", "b", "k", "t"].includes(op)) {
    if (op === "p") { const p = m.parties.find((x) => x.id === a1); if (p) { d.partyId = p.id; d.partyName = p.name; d.partyCandidates = []; d.target = null; } }
    if (op === "n") {
      const kind = ["payment_out", "purchase", "purchase_return"].includes(d.act) ? "supplier" : "customer";
      const { data: np, error } = await db.from("parties").insert({ name: d.partyName, kind, phone: "", address: "", creditDays: 7, openingBalance: 0, currentBalance: 0, customRates: {}, lastOrderDate: "", chase: false }).select().single();
      if (error) return send(chat, "Could not create party: " + esc(error.message));
      d.partyId = np.id; d.partyName = np.name; m.parties.push(np);
      await send(chat, `➕ New ${kind} <b>${esc(np.name)}</b> created (opening 0). Say "${esc(np.name)} opening balance …" to set it.`);
    }
    if (op === "a") d.mode = a1;
    if (op === "i") { const it = m.items.find((x) => x.id === a2), l = d.lines[Number(a1)]; if (it && l) { l.itemId = it.id; l.itemName = it.name; } }
    if (op === "m") d.itemId = a1;
    if (op === "b") d.accountId = a1;
    if (op === "k") { if (a1 === "cash" || a1 === "bank") d.master.accType = a1; else d.master.kind = a1; }
    if (op === "t") d.target = d.targets[Number(a1)] || null;
    if (isTrade(d.act)) priceLines(d, m);
    await findTargets(d);
    await db.from("tg_drafts").update({ draft: d }).eq("id", id);
    const c = card(d, m, id); return edit(chat, mid, c.text, c.markup);
  }

  if (op === "c") {
    if (missing(d)) { const c = card(d, m, id); return edit(chat, mid, c.text, c.markup); }
    const r = await confirmOne(row, m);
    if (!r.ok) return edit(chat, mid, `⚠️ <b>Not posted</b> (#${id}): ${esc(r.text)}`);
    let after = "";
    if (d.partyId) { const { data: p } = await db.from("parties").select("name,currentBalance").eq("id", d.partyId).single(); if (p) after += `\n⚖️ ${esc(p.name)}: <b>${drcr(p.currentBalance || 0)}</b>`; }
    if (d.mode && d.mode !== "credit") { const { data: a } = await db.from("accounts").select("name,balance").eq("id", d.mode).single(); if (a) after += `\n🏦 ${esc(a.name)}: ${inr(a.balance || 0)}`; }
    const body = summary(d, m).filter((l) => !l.startsWith("⚖️") && !l.startsWith("⚠️")).join("\n");
    return edit(chat, mid, `✅ <b>${d.act === "delete_entry" ? "DELETED" : "DONE"}</b> — ${TITLE[d.act]} #${id}\n${body}${after}${d.act === "delete_entry" ? "" : "\n\nSay <i>undo</i> to reverse."}`);
  }
}

// ---------- entry ----------
export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    if (!BOT_TOKEN) return res.status(500).send("TELEGRAM_BOT_TOKEN missing in Vercel env.");
    if (req.query?.setup) {
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const url = `https://${host}/api/telegram`;
      const r = await tg("setWebhook", { url, secret_token: WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
      await tg("setMyCommands", { commands: [
        { command: "help", description: "What I can do" }, { command: "today", description: "Today's report" }, { command: "stock", description: "Stock now" },
        { command: "balance", description: "Cash, bank, receivables" }, { command: "pending", description: "Pending deliveries" },
        { command: "cheques", description: "Pending cheques" }, { command: "parties", description: "All party balances" }, { command: "undo", description: "Undo last entry" }] });
      const t = await db.from("tg_drafts").select("id").limit(1);
      return res.status(200).json({
        version: "v6",
        webhook: r?.ok ? "OK → " + url : r,
        gemini_key: GEMINI_KEY ? "set" : "MISSING (add GEMINI_API_KEY)",
        service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "MISSING (add SUPABASE_SERVICE_ROLE_KEY)",
        owner_chat_ids: OWNER_IDS.length ? OWNER_IDS : "MISSING (TELEGRAM_CHAT_ID)",
        tg_drafts_table: t.error ? "NOT REACHABLE — " + t.error.message : "OK",
      });
    }
    return res.status(200).send("UCD Telegram webhook v6 is alive.");
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== WEBHOOK_SECRET) return res.status(401).send("no");
  const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const chatId = String(update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? "");
  try {
    if (!OWNER_IDS.includes(chatId)) { if (update.message) await send(chatId, `⛔ Not authorised. Your chat id is <code>${chatId}</code>.`); }
    else if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (e: any) { console.error(e); if (chatId) await send(chatId, `⚠️ ${esc(e?.message || e)}`); }
  return res.status(200).send("ok");
}
