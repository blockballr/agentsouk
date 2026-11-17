// Telegram's WebApp handshake, ported to plain ESM so the bot service runs with
// node alone. The initData string is signed by Telegram with the bot token, so it
// proves the account without a second login. Nothing here touches money.

import { createHmac, timingSafeEqual } from "node:crypto";

export function telegramBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token ? token : null;
}

export function webAppUrl(path) {
  const base =
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.BASE_URL?.trim() ||
    "https://app.agentsouk.xyz";
  const clean = base.replace(/\/+$/, "");
  return `${clean}${path.startsWith("/") ? path : `/${path}`}`;
}

export function verifyInitData(initData, opts = {}) {
  const token = telegramBotToken();
  if (!token) return { ok: false, error: "telegram is not configured" };
  if (!initData) return { ok: false, error: "initData is missing" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, error: "hash is missing" };

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, error: "the signature does not match" };
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const maxAge = opts.maxAgeSeconds ?? 86_400;
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, error: "auth_date is missing" };
  if (now - authDate > maxAge) return { ok: false, error: "initData has expired" };

  let parsed = null;
  try {
    parsed = JSON.parse(params.get("user") ?? "null");
  } catch {
    return { ok: false, error: "user is not valid JSON" };
  }
  const id = parsed && typeof parsed.id === "number" ? String(parsed.id) : "";
  if (!id) return { ok: false, error: "user is missing" };

  return {
    ok: true,
    authDate,
    user: {
      id,
      ...(typeof parsed?.username === "string" ? { username: parsed.username } : {}),
      ...(typeof parsed?.first_name === "string" ? { firstName: parsed.first_name } : {}),
    },
  };
}

// shows "typing..." in the chat while the assistant works; it fades on its own after a few seconds
export async function sendTyping(chatId) {
  const token = telegramBotToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// hands a plain message to the assistant on the main API, which answers the chat itself, so this
// webhook returns within telegram's time limit however long the model takes
export async function askAssistant(chatId, text, wallet) {
  const secret = process.env.ASSISTANT_SECRET?.trim();
  const url = process.env.ASSISTANT_API_URL?.trim() || "https://api.agentsouk.xyz/api/assistant/telegram";
  if (!secret) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-assistant-secret": secret },
      body: JSON.stringify({ chatId, text, wallet: wallet ?? null }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTelegramMessage(chatId, text, keyboard) {
  const token = telegramBotToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
