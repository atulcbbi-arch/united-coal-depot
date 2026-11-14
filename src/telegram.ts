import { supabase } from "./supabase";

// Sends via /api/notify (server keeps the bot token secret).
export async function sendTelegramNotification(message: string) {
  try {
    const { data } = await supabase.auth.getSession();
    const jwt = data.session?.access_token;
    if (!jwt) return;
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ text: message }),
    });
  } catch (error) {
    console.error("Failed to send Telegram notification:", error);
  }
}
