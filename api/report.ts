import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  // 1. Backend ke liye Supabase ko environment variables se connect karna
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!
  );

  const time = req.query.time || "evening";
  const now = new Date();
  
  // IST Date manually calculate karna server ke liye
  const istOffset = 5.5 * 60 * 60 * 1000;
  const todayStr = new Date(now.getTime() + istOffset).toISOString().split("T")[0];

  let message = "";

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

    message = `🌅 *Morning Priority Report*\n\n` +
              `🏦 *Cash & Bank Balances*\n${cashBankStr || "No data\n"}\n` +
              `⚠️ *Delayed Payments*\n${delayedStr || "None! All good.\n"}\n` +
              `😴 *Customers Not Buying*\n${inactiveStr || "None\n"}\n` +
              `📦 *Stock Attention Needed*\n${stockStr || "Stock levels are healthy\n"}`;

  } else {
    // === EVENING 9 PM CLOSING REPORT ===
    const [
      { data: bills }, { data: purchases }
    ] = await Promise.all([
      supabase.from("bills").select("*").eq("date", todayStr).eq("isPosted", true),
      supabase.from("purchases").select("*").eq("date", todayStr)
    ]);

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
              `🛒 *Item-wise Purchases Today*\n${purStr || "No purchases today\n"}`;
  }

  // 3. Telegram ko message bhej do
  const token = process.env.VITE_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.VITE_TELEGRAM_CHAT_ID;

  if (token && chatId && message) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown"
      })
    });
  }

  res.status(200).json({ success: true, message: "Report sent to Telegram!" });
}