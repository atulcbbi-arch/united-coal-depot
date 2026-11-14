# United Coal Depot — v6

## v6 changes (reports)
- Morning report now starts with "Deliveries Scheduled Today" (plus any still pending from earlier days)
  and "Cheques To Present Today" (post-dated cheques dated today or earlier, with total).
- EOD report: for every cheque that was due, the bot asks "Was it presented in the bank today?" with buttons:
  "Yes — deposited in <bank>" (marks it cleared: bank up, party balance down; "undo" reverses it) or
  "Not yet — move to next bank day" (skips Sundays and 2nd/4th Saturdays; asked again that evening).
  A cheque that is not answered stays due and is asked again the next evening.

# (v5)

## v5 changes (entry screens)
- Create Bill is one form: Cash / Credit / Advance paid. Only the needed fields show. Several items on every bill,
  remove a line with ✕, customer search with balance, add a new customer from the bill, rate fills from the party's last rate.
- Credit bill "Given now" posts to the ledger immediately; "Deliver later" and "Advance paid" post when marked delivered.
- Any past date is allowed on bills.
- Add Stock: credit/cash buttons, supplier search, several items in one purchase.
- Payment / Expense: Received / Paid / Expense / Cheque buttons, labels on every field, balance-after preview.
- Total and Save stay fixed at the bottom; after saving the form clears and stays on the same page. Save buttons cannot double-post.

# (v4)

## v4 changes (app screens)
- Party ledger rebuilt: Date | Particulars | Dr | Cr | Balance, fits a phone, opening + totals + closing rows,
  item/kg/rate in particulars, search party, This month / Last month / FY / All, Print (A4), WhatsApp, CSV.
- FIX: cash sales and cash purchases no longer go into party ledgers; returns show on the correct side.
- FIX: editing a payment/purchase from Reports used to delete the entry.
- FIX: editing a party in Settings flipped a Cr opening to Dr and wiped phone/address. Opening now has a Dr/Cr choice.
- Reports tabs (Sales, Purchase, Stock, Dues) fit phones with totals. Bottom nav: Home, Bill, Entry, Reports, More.
- Tap a ledger row for Edit / Delete (works on phone).

# (v3) Full Telegram voice control

## v3 fix
- When a Gemini model is busy ("high demand"), the bot now tries other Gemini models automatically instead of failing.

Stack: Vite + React on Vercel, data in Supabase, Telegram bot for reports and voice/text entries.

## Telegram bot setup (one time, ~10 min)

1. **Supabase → SQL Editor** → paste `supabase/telegram-bot.sql` → Run.
2. **Supabase → Project Settings → API** → copy the `service_role` key.
3. **Google AI Studio** (aistudio.google.com → Get API key) → create a Gemini key (free tier is enough).
4. **Vercel → Project → Settings → Environment Variables** → add:
   - `SUPABASE_SERVICE_ROLE_KEY` = key from step 2
   - `GEMINI_API_KEY` = key from step 3
   - `TELEGRAM_BOT_TOKEN` = same value as your current `VITE_TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID` = same value as your current `VITE_TELEGRAM_CHAT_ID`
5. Push this code to GitHub (Vercel redeploys).
6. Open in browser: `https://united-coal-depot.vercel.app/api/telegram?setup=1`
   Every line must say OK / set.
7. In Telegram send the bot: `/help`

## Using it
Voice note or text, e.g. *"Payment recd Rs 50000 from ABC Bakers today cash"* → bot shows the draft →
tap ✅ Confirm & Post. Missing info (party, cash/bank, item) is asked with buttons. Say *undo* to reverse
the last Telegram entry. Ask *"ABC Bakers balance"* or *"cash balance"* anytime.

## After it works (security)
Delete `VITE_TELEGRAM_BOT_TOKEN` and `VITE_TELEGRAM_CHAT_ID` from Vercel. The old app shipped the bot
token inside the website; this version doesn't. For full safety, BotFather → /revoke → put the new token in
`TELEGRAM_BOT_TOKEN` → open the setup link (step 6) again.

## v2 — what the bot can do (voice or text)
- Money: payment in / out, expenses, post-dated cheque received, cheque cleared
- Sales: walk-in, credit, scheduled delivery, mark delivered, cancel delivery
- Purchases (cash/credit), sales return, purchase return
- Setup: new party (with opening balance Dr/Cr, phone, address, credit days), change opening balance,
  new item (rate + opening stock), change rate / opening stock, stock shortage/excess, new cash/bank account
- Fix: undo last entry, delete any entry ("delete ABC payment 5000")
- Ask: party balance, party khata (statement), stock, pending deliveries, cheques, today's report, all parties
- Many entries in one voice note (e.g. 20 opening balances) → one list card → "Post all ready"
- Menu commands: /today /stock /balance /pending /cheques /parties /undo

Returns are saved as minus-quantity sales/purchases, so stock, balances and reports adjust automatically.
Stock shortage/excess adjusts the item's opening stock.

## v2 fixes
- Deleting a pending (uncleared) cheque in the app wrongly changed the party balance.

## v1 changes
- `api/telegram.ts` — new: voice/text → draft → confirm → posts payment in/out, expense, sale (cash/credit/scheduled),
  purchase; creates new parties; undo; balance queries. Only your chat id is obeyed.
- `api/notify.ts` + `src/telegram.ts` — app alerts go through the server; bot token no longer in the website.
- `src/lib/store.ts` — FIX: editing a payment or purchase used to add the amount to balances twice.
- `api/report.ts` — EOD report now includes payments received/paid and expenses.
