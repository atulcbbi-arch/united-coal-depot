import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  // 1. Backend ke liye Supabase ko environment variables se connect karna
  const supabase = createClient(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)!,
    { auth: { persistSession: false } }
  );

  const time = req.query.time || "evening";
  const now = new Date();
  
  // IST Date manually calculate karna server ke liye
  const istOffset = 5.5 * 60 * 60 * 1000;
  const todayStr = new Date(now.getTime() + istOffset).toISOString().split("T")[0];

  let message = "";
  const followUps: { text: string; reply_markup: any }[] = []; // extra messages with buttons (EOD cheque check)
  const md = (x: any) => String(x ?? "").replace(/[_*`\[\]]/g, " ");          // keep Telegram Markdown from breaking on names
  const rs = (n: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n || 0);
  const dd = (iso: string) => (iso ? new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
  const html = (x: any) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Post-dated cheques that are due (cheque date today or earlier) and still pending
  const { data: pdcAll } = await supabase.from("money").select("*").eq("type", "pdc_in").eq("status", "pending");
  const dueCheques = (pdcAll || [])
    .filter((c: any) => c.clearanceDate && c.clearanceDate <= todayStr)
    .sort((a: any, b: any) => String(a.clearanceDate).localeCompare(String(b.clearanceDate)));

  if (time === "morning") {
    // === MORNING 9 AM REPORT ===
    const [
      { data: parties }, { data: accounts }, { data: items }, { data: purchases }, { data: bills }
    ] = await Promise.all([
      supabase.from("parties").select("*"),
      supabase.from("accounts").select("*"),
      supabase.from("items").select("*"),
      supabase.from("purchases").select("itemId, kg"),
      supabase.from("bills").select("isPosted, lines")
    ]);

    // A. Cash & Bank Balances
    let cashBankStr = "";
    (accounts || []).forEach((a: any) => {
      cashBankStr += `- ${a.name}: ₹${a.balance || 0}\n`;
    });

    // B. Delayed Payments & Inactive Customers
    let delayedStr = "";
    let inactiveStr = "";
    (parties || []).forEach((p: any) => {
      if (p.kind === "customer" && p.lastOrderDate) {
        const diff = Math.floor((now.getTime() - new Date(p.lastOrderDate).getTime()) / (1000 * 3600 * 24));
        if (p.currentBalance > 0 && diff > (p.creditDays || 7)) {
          delayedStr += `- ${p.name}: ₹${p.currentBalance} (${diff} days overdue)\n`;
        }
        if (diff >= 7 && p.currentBalance === 0) {
          inactiveStr += `- ${p.name} (Not bought since ${p.lastOrderDate})\n`;
        }
      }
    });

    // C. Stock Calculation (Live)
    const stockMap = new Map();
    (items || []).forEach((i: any) => stockMap.set(i.id, { name: i.name, qty: i.openingStock || 0 }));
    (purchases || []).forEach((p: any) => {
      if (stockMap.has(p.itemId)) stockMap.get(p.itemId).qty += p.kg;
    });
    (bills || []).forEach((b: any) => {
      if (b.isPosted) {
        b.lines.forEach((l: any) => {
          if (stockMap.has(l.itemId)) stockMap.get(l.itemId).qty -= l.kg;
        });
      }
    });

    let stockStr = "";
    stockMap.forEach((v) => {
      if (v.qty <= 500) stockStr += `- ${v.name}: ${v.qty} kg left\n`;
    });

    // D. Deliveries scheduled for today (and any still pending from earlier days)
    const { data: sched } = await supabase.from("bills").select("*").eq("deliveryStatus", "scheduled");
    const delLine = (b: any) => `- ${md(b.customerName)}${b.deliveryTime ? " @ " + b.deliveryTime : ""}: ${(b.lines || []).map((l: any) => `${md(l.itemName)} ${l.kg} kg`).join(", ")} (${rs(b.total)})${b.saleType === "prepaid_delivery" ? " · paid" : " · credit"}\n`;
    const todayDel = (sched || []).filter((b: any) => (b.deliveryDate || b.date) === todayStr).sort((a: any, b: any) => String(a.deliveryTime || "99").localeCompare(String(b.deliveryTime || "99")));
    const lateDel = (sched || []).filter((b: any) => (b.deliveryDate || b.date) < todayStr).sort((a: any, b: any) => String(a.deliveryDate || a.date).localeCompare(String(b.deliveryDate || b.date)));
    let deliveryStr = todayDel.map(delLine).join("");
    if (lateDel.length) deliveryStr += `_Pending from earlier:_\n` + lateDel.map((b: any) => `- ${dd(b.deliveryDate || b.date)} · ` + delLine(b).slice(2)).join("");

    // E. Post-dated cheques to present today
    const chequeTotal = dueCheques.reduce((t: number, c: any) => t + (c.amount || 0), 0);
    const chequeStr = dueCheques.map((c: any) => `- ${md(c.partyName)}: ${rs(c.amount)} · chq ${md(c.chequeNumber || "-")} · dated ${dd(c.clearanceDate)}${c.clearanceDate < todayStr ? " (overdue)" : ""}\n`).join("");

    message = `🌅 *Morning Priority Report*\n\n` +
              `🚚 *Deliveries Scheduled Today${todayDel.length ? ` (${todayDel.length})` : ""}*\n${deliveryStr || "None today\n"}\n` +
              `🏛 *Cheques To Present Today${dueCheques.length ? ` (${rs(chequeTotal)})` : ""}*\n${chequeStr || "None today\n"}\n` +
              `🏦 *Cash & Bank Balances*\n${cashBankStr || "No data\n"}\n` +
              `⚠️ *Delayed Payments*\n${delayedStr || "None! All good.\n"}\n` +
              `😴 *Customers Not Buying*\n${inactiveStr || "None\n"}\n` +
              `📦 *Stock Attention Needed*\n${stockStr || "Stock levels are healthy\n"}`;

  } else {
    // === EVENING 9 PM CLOSING REPORT ===
    const [
      { data: bills }, { data: purchases }, { data: money }
    ] = await Promise.all([
      supabase.from("bills").select("*").eq("date", todayStr).eq("isPosted", true),
      supabase.from("purchases").select("*").eq("date", todayStr),
      supabase.from("money").select("*").eq("date", todayStr)
    ]);
    let recd = 0, paid = 0, exp = 0;
    let moneyStr = "";
    (money || []).forEach((m: any) => {
      if (m.type === "payment_in") { recd += m.amount; moneyStr += `- 🟢 ${m.partyName || "-"}: ₹${m.amount}\n`; }
      else if (m.type === "payment_out") { paid += m.amount; moneyStr += `- 🔴 ${m.partyName || "-"}: ₹${m.amount}\n`; }
      else if (m.type === "expense") { exp += m.amount; moneyStr += `- 🧾 ${m.notes || "Expense"}: ₹${m.amount}\n`; }
    });

    let cashSaleTotal = 0;
    const itemSales: Record<string, { kg: number, amt: number }> = {};
    const itemPurchases: Record<string, { kg: number, amt: number }> = {};

    (bills || []).forEach((b: any) => {
      if (b.saleType === "walkin" || b.saleType === "prepaid_delivery") {
        cashSaleTotal += b.total;
      }
      b.lines.forEach((l: any) => {
        if (!itemSales[l.itemName]) itemSales[l.itemName] = { kg: 0, amt: 0 };
        itemSales[l.itemName].kg += l.kg;
        itemSales[l.itemName].amt += l.amount;
      });
    });

    (purchases || []).forEach((p: any) => {
      if (!itemPurchases[p.itemName]) itemPurchases[p.itemName] = { kg: 0, amt: 0 };
      itemPurchases[p.itemName].kg += p.kg;
      itemPurchases[p.itemName].amt += p.total;
    });

    let saleStr = "";
    for (const [name, d] of Object.entries(itemSales)) {
      saleStr += `- ${name}: ${d.kg} kg (₹${d.amt})\n`;
    }

    let purStr = "";
    for (const [name, d] of Object.entries(itemPurchases)) {
      purStr += `- ${name}: ${d.kg} kg (₹${d.amt})\n`;
    }

    message = `🌃 *EOD Closing Report (${todayStr})*\n\n` +
              `💰 *Total Cash / Advance Received:* ₹${cashSaleTotal}\n\n` +
              `📈 *Item-wise Sales Today*\n${saleStr || "No sales today\n"}\n` +
              `🛒 *Item-wise Purchases Today*\n${purStr || "No purchases today\n"}\n` +
              `💸 *Ledger Today*  In ₹${recd} | Out ₹${paid} | Exp ₹${exp}\n${moneyStr || "No payments today\n"}` +
              (dueCheques.length ? `\n🏛 *${dueCheques.length} cheque${dueCheques.length > 1 ? "s" : ""} were due today* — please answer below 👇\n` : "");

    // Ask about every due cheque: deposited (pick the bank) or not yet (move to the next bank day).
    // The buttons are handled by api/telegram.ts (callback data "qb:" / "qn:").
    if (dueCheques.length) {
      const { data: accs } = await supabase.from("accounts").select("*");
      const sorted = (accs || []).slice().sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
      const banks = sorted.filter((a: any) => a.type === "bank");
      const choices = (banks.length ? banks : sorted).slice(0, 6);
      for (const c of dueCheques.slice(0, 20)) {
        const kb: any[][] = choices.map((a: any, i: number) => [{ text: `✅ Yes — deposited in ${a.name}`, callback_data: `qb:${c.id}:${i}` }]);
        kb.push([{ text: "📅 Not yet — move to next bank day", callback_data: `qn:${c.id}` }]);
        followUps.push({
          text: `🏛 <b>Cheque due</b>\n👤 ${html(c.partyName)}\n💰 <b>${rs(c.amount)}</b> · chq ${html(c.chequeNumber || "-")} · dated ${dd(c.clearanceDate)}\n\n<b>Was it presented in the bank today?</b>`,
          reply_markup: { inline_keyboard: kb },
        });
      }
    }
  }

  // 3. Telegram ko message bhej do
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_ID || process.env.VITE_TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);

  for (const chatId of chatIds) if (token && message) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown"
      })
    });
    for (const f of followUps) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: f.text, parse_mode: "HTML", reply_markup: f.reply_markup })
      });
    }
  }

  res.status(200).json({ success: true, message: "Report sent to Telegram!" });
}