// The bot's only proof of identity is Telegram's signature over initData, so the
// verifier is tested against a real HMAC, a tampered payload and an old one.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { telegramLinkMessage } from "@agora/core";
import { verifyInitData } from "../apps/telegram/src/telegram.js";
import { telegramLinkMessage as serviceLinkMessage } from "../apps/telegram/src/link-message.js";

const TOKEN = "123456:test-token";
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
  delete process.env.DATABASE_URL;
});

function sign(params: Record<string, string>, token = TOKEN): string {
  const dataCheck = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

function payload(overrides: Record<string, string> = {}) {
  return {
    query_id: "AAH-test",
    user: JSON.stringify({ id: 42, username: "souk", first_name: "Souk" }),
    auth_date: String(Math.floor(Date.now() / 1000)),
    ...overrides,
  };
}

describe("telegram initData", () => {
  it("accepts a payload Telegram signed", () => {
    const result = verifyInitData(sign(payload()));
    expect(result.ok).toBe(true);
    expect(result.user?.id).toBe("42");
    expect(result.user?.username).toBe("souk");
  });

  it("rejects a payload changed after it was signed", () => {
    const signed = sign(payload());
    const tampered = signed.replace("souk", "mallory");
    expect(verifyInitData(tampered).ok).toBe(false);
  });

  it("rejects a payload signed with another bot token", () => {
    expect(verifyInitData(sign(payload(), "999:other")).ok).toBe(false);
  });

  it("rejects an old auth_date", () => {
    const old = String(Math.floor(Date.now() / 1000) - 90_000);
    const result = verifyInitData(sign(payload({ auth_date: old })));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/);
  });

  it("rejects a payload with no user", () => {
    const result = verifyInitData(sign({ query_id: "x", auth_date: String(Math.floor(Date.now() / 1000)) }));
    expect(result.ok).toBe(false);
  });
});

describe("the link message", () => {
  it("keeps the service and the app on the same bytes", () => {
    const input = { telegramId: "42", wallet: "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713" };
    expect(serviceLinkMessage(input)).toBe(telegramLinkMessage(input));
  });

  it("proves the wallet that signed it", async () => {
    const account = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    const message = telegramLinkMessage({ telegramId: "42", wallet: account.address });
    const signature = await account.signMessage({ message });
    expect(await verifyMessage({ address: account.address, message, signature })).toBe(true);
  });
});

describe("the link store", () => {
  it("links a chat to a wallet and reads it both ways", async () => {
    vi.resetModules();
    const store = await import("../apps/telegram/src/link-store.js");
    const wallet = "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713";
    const saved = await store.linkTelegram({ telegramId: "42", wallet, username: "souk" });
    expect(saved.ok).toBe(true);
    expect(await store.walletForTelegram("42")).toBe(wallet.toLowerCase());
    expect(await store.telegramForWallet(wallet)).toBe("42");
  });
});
