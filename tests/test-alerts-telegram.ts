// Telegram delivery started from the website: only the wallet itself may ask, the bot hands back a
// one-time link, /start with that code links the chat that opened it, and a used code links nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const proof = vi.hoisted(() => ({
  proofFromHeaders: (h: Headers) => ({ message: h.get("x-agentsouk-message"), signature: h.get("x-agentsouk-signature") }),
  verifyWalletProof: vi.fn(async ({ wallet, signature }: { wallet: string; signature?: string | null }) => signature === `signed-by-${wallet.toLowerCase()}`),
}));
vi.mock("@/lib/wallet-proof", () => proof);

const wallet = "0x84FEDaBd1B83443Ad86796C15619494878B64180";
const signed = { "x-agentsouk-message": "bWVzc2FnZQ==", "x-agentsouk-signature": `signed-by-${wallet.toLowerCase()}` };

describe("the website's Telegram delivery route", () => {
  const calls: { url: string; body: unknown; secret: string | null }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("ASSISTANT_SECRET", "s3cret");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), secret: (init.headers as Record<string, string>)["x-assistant-secret"] ?? null });
      return new Response(JSON.stringify({ ok: true, url: "https://t.me/agentsouk_bot?start=abc" }));
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refuses a caller who has not proven the wallet", async () => {
    const { POST } = await import("../src/app/api/alerts/telegram/route");
    const res = await POST(new NextRequest("https://api.agentsouk.xyz/api/alerts/telegram", { method: "POST", body: JSON.stringify({ wallet }) }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("asks the bot for a link with the shared secret once the wallet is proven", async () => {
    const { POST } = await import("../src/app/api/alerts/telegram/route");
    const res = await POST(new NextRequest("https://api.agentsouk.xyz/api/alerts/telegram", { method: "POST", headers: signed, body: JSON.stringify({ wallet }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, url: "https://t.me/agentsouk_bot?start=abc" });
    expect(calls[0]).toMatchObject({ body: { wallet, action: "start" }, secret: "s3cret" });
    expect(calls[0]!.url).toMatch(/\/telegram\/wallet-link$/);
  });
});

function request(body: unknown, headers: Record<string, string>) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as Readable & { method: string; headers: Record<string, string> };
  req.method = "POST";
  req.headers = headers;
  return req;
}

function response() {
  const res = { status: 0, body: "", writeHead(status: number) { res.status = status; return res; }, setHeader() {}, end(chunk?: string) { res.body = chunk ?? ""; } };
  return res;
}

describe("the bot's side of a website link", () => {
  const sent: { chat_id: unknown; text: string }[] = [];
  beforeEach(() => {
    vi.resetModules();
    sent.length = 0;
    vi.stubEnv("ASSISTANT_SECRET", "s3cret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "hook");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init?.body) sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }));
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function walletLink(action: string) {
    const { handleWalletLink } = await import("../apps/telegram/src/routes.js");
    const res = response();
    await handleWalletLink(request({ wallet, action }, { "x-assistant-secret": "s3cret" }) as never, res as never);
    return { status: res.status, body: JSON.parse(res.body) };
  }

  async function startWith(code: string, chatId: number) {
    const { handleWebhook } = await import("../apps/telegram/src/routes.js");
    const res = response();
    const update = { message: { chat: { id: chatId }, from: { username: "block" }, text: `/start ${code}` } };
    await handleWebhook(request(update, { "x-telegram-bot-api-secret-token": "hook" }) as never, res as never);
  }

  it("links the chat that opens the code, once, and can be undone", async () => {
    const started = await walletLink("start");
    expect(started.status).toBe(200);
    const code = new URL(started.body.url).searchParams.get("start")!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{8,}$/);

    expect((await walletLink("status")).body).toMatchObject({ linked: false });
    await startWith(code, 777);
    expect(sent.at(-1)!.text).toContain("Linked to");
    expect((await walletLink("status")).body).toMatchObject({ linked: true, username: "block" });

    // the same code a second time links nothing new
    await startWith(code, 888);
    expect(sent.at(-1)!.text).toContain("expired or was already used");

    expect((await walletLink("unlink")).body).toMatchObject({ removed: 1 });
    expect((await walletLink("status")).body).toMatchObject({ linked: false });
  });

  it("refuses a caller without the shared secret", async () => {
    const { handleWalletLink } = await import("../apps/telegram/src/routes.js");
    const res = response();
    await handleWalletLink(request({ wallet, action: "start" }, { "x-assistant-secret": "wrong" }) as never, res as never);
    expect(res.status).toBe(401);
  });
});
