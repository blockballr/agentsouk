// The notification feed is private to its wallet, so the API trusts only a
// sign-in statement that recovers to that wallet, names an allowed site, and is
// fresh. These pin each rejection.
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyWalletProof } from "../src/lib/wallet-proof";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
const SITE = "https://app.agentsouk.xyz";
const NOW = Date.parse("2026-11-09T06:00:00Z");

function statement(issuedAgoMs = 60_000, address = account.address, site = SITE): string {
  return [
    "Agent Souk sign-in",
    `site: ${site}`,
    `address: ${address.toLowerCase()}`,
    `issued: ${new Date(NOW - issuedAgoMs).toISOString()}`,
  ].join("\n");
}

async function proof(overrides: { message?: string; signer?: typeof account } = {}) {
  const message = overrides.message ?? statement();
  const signature = await (overrides.signer ?? account).signMessage({ message });
  return { wallet: account.address, message, signature, now: NOW, sites: [SITE] };
}

describe("wallet proof", () => {
  it("accepts a fresh statement signed by the wallet", async () => {
    expect(await verifyWalletProof(await proof())).toBe(true);
  });

  it("refuses a missing or malformed signature", async () => {
    const base = await proof();
    expect(await verifyWalletProof({ ...base, signature: null })).toBe(false);
    expect(await verifyWalletProof({ ...base, signature: "0x12" })).toBe(false);
    expect(await verifyWalletProof({ ...base, message: null })).toBe(false);
  });

  it("refuses a statement for another address", async () => {
    const base = await proof();
    expect(await verifyWalletProof({ ...base, wallet: other.address })).toBe(false);
  });

  it("refuses a statement signed by another key", async () => {
    const message = statement();
    expect(await verifyWalletProof(await proof({ message, signer: other }))).toBe(false);
  });

  it("refuses a site outside the allowlist", async () => {
    const message = statement(60_000, account.address, "https://souk.example");
    const signature = await account.signMessage({ message });
    expect(await verifyWalletProof({ wallet: account.address, message, signature, now: NOW, sites: [SITE] })).toBe(false);
  });

  it("refuses a statement older than the session window", async () => {
    const message = statement(8 * 24 * 60 * 60 * 1000);
    const signature = await account.signMessage({ message });
    expect(await verifyWalletProof({ wallet: account.address, message, signature, now: NOW, sites: [SITE] })).toBe(false);
  });

  it("refuses a statement issued in the future beyond the skew", async () => {
    const message = statement(-10 * 60 * 1000);
    const signature = await account.signMessage({ message });
    expect(await verifyWalletProof({ wallet: account.address, message, signature, now: NOW, sites: [SITE] })).toBe(false);
  });

  it("refuses a tampered address line", async () => {
    const message = statement().replace(account.address.toLowerCase(), other.address.toLowerCase());
    const signature = await account.signMessage({ message });
    expect(await verifyWalletProof({ wallet: account.address, message, signature, now: NOW, sites: [SITE] })).toBe(false);
  });
});
