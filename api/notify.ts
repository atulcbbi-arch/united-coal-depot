// Server-side relay for app notifications, so the bot token never ships inside the website.
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_ID || process.env.VITE_TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || !chatIds.length) return res.status(200).json({ ok: false, reason: "telegram env missing" });

  // only a signed-in app user may send
  const jwt = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const sb = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "", process.env.VITE_SUPABASE_ANON_KEY || "", { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user) return res.status(401).json({ ok: false });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const text = String(body.text || "").slice(0, 4000);
  if (!text) return res.status(400).json({ ok: false });
  await Promise.all(chatIds.map((chat_id) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, parse_mode: "Markdown" }),
  })));
  return res.status(200).json({ ok: true });
}
