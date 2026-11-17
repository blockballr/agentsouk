// A notification reaches the wallet's linked Telegram chat once: a fresh event is forwarded to
// the bot, a retried one is not, and the bot only sends to a linked chat that has not muted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

vi.mock("server-only", () => ({}));

const durable = vi.hoisted(() => ({ saveNotification: vi.fn(async () => true) }));
vi.mock("../src/lib/durable-store", () => ({
  ...durable,
  deleteAllNotifications: vi.fn(),
  deleteNotification: vi.fn(),
  loadNotifications: vi.fn(async () => []),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));

const event = { wallet: "0x84FEDaBd1B83443Ad86796C15619494878B64180", kind: "job_completed" as const, eventKey: "57107", title: "Job delivered", body: "Souk Health Guard delivered.", href: "/ongoing" };

describe("forwarding a notification to Telegram", () => {
  const fetchSpy = vi.fn(async () => new Response("{}"));
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("ASSISTANT_SECRET", "s3cret");
  });
  afterEach(() => {
    fetchSpy.mockClear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("forwards a fresh event with the shared secret", async () => {
    durable.saveNotification.mockResolvedValueOnce(true);
    const { emitNotification } = await import("../src/lib/notifications");
    await emitNotification(event);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/telegram\/notify$/);
    expect((init.headers as Record<string, string>)["x-assistant-secret"]).toBe("s3cret");
    expect(JSON.parse(String(init.body))).toMatchObject({ title: "Job delivered", href: "/ongoing" });
  });

  it("stays quiet when the event was already recorded", async () => {
    durable.saveNotification.mockResolvedValueOnce(false);
    const { emitNotification } = await import("../src/lib/notifications");
    await emitNotification(event);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never fails the event when the bot cannot be reached", async () => {
    durable.saveNotification.mockResolvedValueOnce(true);
    fetchSpy.mockRejectedValueOnce(new Error("down"));
    const { emitNotification } = await import("../src/lib/notifications");
    await expect(emitNotification(event)).resolves.toMatchObject({ title: "Job delivered" });
  });
});

// a node request and response pair, enough for the bot's route handlers
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

describe("the bot's notify route", () => {
  const sent: { chat_id: unknown; text: string }[] = [];
  beforeEach(() => {
    vi.resetModules();
    sent.length = 0;
    vi.stubEnv("ASSISTANT_SECRET", "s3cret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }));
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refuses a caller without the secret", async () => {
    const { handleNotify } = await import("../apps/telegram/src/routes.js");
    const res = response();
    await handleNotify(request({ wallet: event.wallet, title: "x" }, { "x-assistant-secret": "wrong" }) as never, res as never);
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("sends to the linked chat, escaped, and stops once the chat mutes", async () => {
    const store = await import("../apps/telegram/src/link-store.js");
    await store.linkTelegram({ telegramId: "777", wallet: event.wallet });
    const { handleNotify } = await import("../apps/telegram/src/routes.js");

    const first = response();
    await handleNotify(request({ wallet: event.wallet, title: "Paid <now>", body: "0.02 U", href: "/ongoing" }, { "x-assistant-secret": "s3cret" }) as never, first as never);
    expect(JSON.parse(first.body)).toMatchObject({ ok: true, sent: true });
    expect(sent[0]).toMatchObject({ chat_id: "777" });
    expect(sent[0]!.text).toContain("Paid &lt;now&gt;");
    expect(sent[0]!.text).toContain('href="https://app.agentsouk.xyz/ongoing"');

    await store.setMuted("777", true);
    const second = response();
    await handleNotify(request({ wallet: event.wallet, title: "Again" }, { "x-assistant-secret": "s3cret" }) as never, second as never);
    expect(JSON.parse(second.body)).toMatchObject({ sent: false, reason: "muted" });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing for a wallet with no linked chat", async () => {
    const { handleNotify } = await import("../apps/telegram/src/routes.js");
    const res = response();
    await handleNotify(request({ wallet: "0x0000000000000000000000000000000000000001", title: "x" }, { "x-assistant-secret": "s3cret" }) as never, res as never);
    expect(JSON.parse(res.body)).toMatchObject({ sent: false, reason: "not linked" });
    expect(sent).toHaveLength(0);
  });
});
