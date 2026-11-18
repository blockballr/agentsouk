import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { assistantTurn } from "@/lib/assistant/run";
import type { AssistantAction } from "@/lib/assistant/brain";
import { toTelegramHtml } from "@/lib/assistant/telegram-format";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/assistant/telegram {chatId, text, wallet?} - called by the telegram service with the
// shared ASSISTANT_SECRET. it answers at once, so the bot's webhook never waits on the model, and
// sends the reply to the chat itself once the assistant has it

const LIMIT = { table: "rate_assistant_telegram", limit: 8, windowMs: 60_000 };

function secretOk(given: string | null): boolean {
  const expected = process.env.ASSISTANT_SECRET?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sendToChat(chatId: number | string, text: string, actions: AssistantAction[] = []): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: toTelegramHtml(text),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      // each prepared action as its own button under the answer
      ...(actions.length ? { reply_markup: { inline_keyboard: actions.map((a) => [{ text: a.label, url: a.url }]) } } : {}),
    }),
  }).catch(() => {});
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!secretOk(req.headers.get("x-assistant-secret"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { chatId?: unknown; text?: unknown; wallet?: unknown } | null;
  const chatId = typeof body?.chatId === "number" || (typeof body?.chatId === "string" && /^-?\d+$/.test(body.chatId)) ? body.chatId : null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (chatId === null || !text) return NextResponse.json({ ok: false, error: "chatId and text are required" }, { status: 400 });
  const wallet = typeof body?.wallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(body.wallet) ? body.wallet : null;

  const verdict = await enforceRateLimit(LIMIT, { keys: [`chat:${chatId}`] }).catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
  if (!verdict.allowed) {
    after(() => sendToChat(chatId as number | string, `You are sending messages quickly. Try again in ${verdict.retryAfterSeconds} seconds.`));
    return NextResponse.json({ ok: true, queued: false }, { status: 202 });
  }

  after(async () => {
    const reply = await assistantTurn(`tg:${chatId}`, text, wallet);
    await sendToChat(chatId as number | string, reply.text, reply.actions);
  });
  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}
