// a completed passport gets a number, once, tied to the wallet that earned it: the day and
// month it was issued, then its place in the order passports were issued. These run without
// a database, where the passports live in memory
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
  return { payments: new Map<string, unknown[]>(), agents: [] as unknown[] };
});

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/receipts-store", () => ({
  listPaymentsByClient: async (wallet: string) => store.payments.get(wallet.toLowerCase()) ?? [],
  receiptsMode: () => "memory",
}));
vi.mock("../src/lib/scanner", () => ({
  queryAgents: async () => ({ items: store.agents, total: store.agents.length }),
}));

import { NextRequest } from "next/server";
import { CATEGORY_KEYS } from "@agora/core";
import { serialLabel } from "../src/lib/passport-serial";
import { issuePassport, resetPassportsForTests } from "../src/lib/passport-store";
import { GET as progressRoute } from "../src/app/api/quest/progress/route";

const FIRST = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const SECOND = "0x250957fd89b82c46208fc041ee0d8c99c5e62247";
const SELLER = "0x1111111111111111111111111111111111111111";

// a wallet that has hired in all four categories and listed one agent of its own
function complete(wallet: string, ownToken: string) {
  store.agents.push({ chain_id: 97, token_id: ownToken, name: "Own", category: "yield", owner_address: wallet });
  store.payments.set(
    wallet.toLowerCase(),
    CATEGORY_KEYS.map((category, i) => ({
      paymentId: `req_${ownToken}_${i}`,
      mode: "prod",
      agent: { chainId: 97, tokenId: `90${i}`, name: category },
      payTo: SELLER,
      txHash: `0xabc${i}`,
      createdAt: `2026-10-01T0${i}:00:00Z`,
    })),
  );
}

async function progress(wallet: string) {
  const res = await progressRoute(new NextRequest(`https://api.agentsouk.xyz/api/quest/progress?wallet=${wallet}`));
  return res.json();
}

beforeEach(() => {
  resetPassportsForTests();
  store.payments.clear();
  store.agents = CATEGORY_KEYS.map((category, i) => ({ chain_id: 97, token_id: `90${i}`, name: category, category, owner_address: SELLER }));
});

describe("the printed number", () => {
  it("is the day and month of issue, then the count", () => {
    expect(serialLabel(0, "2026-10-01T09:00:00Z")).toBe("0110000");
    expect(serialLabel(1, "2026-10-01T23:59:59Z")).toBe("0110001");
    expect(serialLabel(12, new Date("2026-10-02T00:00:00Z"))).toBe("0210012");
    expect(serialLabel(1000, "2026-11-13T12:00:00Z")).toBe("13111000");
  });
});

describe("issuing", () => {
  it("gives a wallet one passport, the same on every call and in any letter case", async () => {
    const first = await issuePassport(FIRST, null);
    expect(first?.number).toBe(1);
    expect(await issuePassport(FIRST.toUpperCase().replace("0X", "0x"), null)).toEqual(first);
  });

  it("numbers wallets in the order they were issued", async () => {
    await issuePassport(FIRST, null);
    expect((await issuePassport(SECOND, null))?.number).toBe(2);
    expect((await issuePassport(FIRST, null))?.number).toBe(1);
  });
});

describe("the passport read", () => {
  it("carries no number until the passport is complete", async () => {
    const body = await progress(FIRST);
    expect(body.completed).toBe(false);
    expect(body.passport).toBeNull();
  });

  it("issues the number on the first read of a complete passport, and keeps it", async () => {
    complete(FIRST, "3001");
    const body = await progress(FIRST);
    expect(body.completed).toBe(true);
    expect(body.passport.number).toBe(1);
    expect(body.passport.serial).toBe(serialLabel(1, body.passport.issuedAt));
    expect(body.passport.serial).toMatch(/^\d{4}001$/);
    expect((await progress(FIRST)).passport).toEqual(body.passport);
  });

  it("gives the next wallet to complete the next number", async () => {
    complete(FIRST, "3001");
    complete(SECOND, "3002");
    await progress(FIRST);
    expect((await progress(SECOND)).passport.number).toBe(2);
  });
});
