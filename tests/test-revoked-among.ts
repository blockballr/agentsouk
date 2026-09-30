// The catalogue asks the receipts store which sessions were revoked elsewhere.
// Only a stored revoke may reach this instance's ledger: a read that raced a
// revoke here can come back holding the old activated true, and writing that
// back would let a revoked session run tasks again.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.RECEIPTS_STORE = "postgres";
});

const db = vi.hoisted(() => ({ revokedIds: [] as string[], queries: 0, stalePayload: {} as Record<string, unknown> }));

vi.mock("postgres", () => {
  const sql = (strings: TemplateStringsArray | unknown[], ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in strings)) return strings;
    const text = strings.join("?");
    if (text.includes("from receipts") && text.includes("activated")) {
      db.queries += 1;
      const asked = (values[0] as string[]) ?? [];
      return Promise.resolve(db.revokedIds.filter((id) => asked.includes(id)).map((payment_id) => ({ payment_id })));
    }
    // a full receipt read that raced the revoke still holds the old activated true
    if (text.includes("select payload from receipts")) {
      return Promise.resolve([{ payload: { ...db.stalePayload, activated: true } }]);
    }
    return Promise.resolve([]);
  };
  return { default: () => sql };
});

import { getPayment, recordPayment } from "../src/lib/x402";
import { revokedAmong, sessionRevoked } from "../src/lib/receipts-store";

function session(paymentId: string, activated: boolean) {
  recordPayment({
    paymentId,
    client: "0xabc",
    agent: { chainId: 97, tokenId: "1", name: "T", receiver: "0x0" },
    activated,
    session: { spendCapUsd: 5, expiresAt: new Date(Date.now() + 3600000).toISOString() },
    mode: "prod",
    createdAt: new Date().toISOString(),
  } as never);
}

describe("revoked sessions read in one query", () => {
  it("carries a revoke recorded elsewhere into this ledger", async () => {
    session("pay_elsewhere", true);
    db.revokedIds = ["pay_elsewhere"];
    const revoked = await revokedAmong(["pay_elsewhere", "pay_live"]);
    expect([...revoked]).toEqual(["pay_elsewhere"]);
    expect(getPayment("pay_elsewhere")?.activated).toBe(false);
  });

  it("never switches a session this instance revoked back on", async () => {
    session("pay_here", false);
    db.revokedIds = [];
    db.stalePayload = { ...getPayment("pay_here") };
    expect(await sessionRevoked("pay_here")).toBe(false);
    expect(getPayment("pay_here")?.activated).toBe(false);
  });

  it("asks once for a whole page and not at all for an empty one", async () => {
    db.queries = 0;
    await revokedAmong(["a", "b", "c"]);
    await revokedAmong([]);
    expect(db.queries).toBe(1);
  });
});
