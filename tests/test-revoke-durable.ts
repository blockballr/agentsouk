import { describe, it, expect, vi } from "vitest";

// receipts-store.ts carries the "server-only" marker, which throws outside a
// server bundle; the marker is a build guard, not part of the logic under test
vi.mock("server-only", () => ({}));

import { recordPayment, getPayment } from "../src/lib/x402";
import { revokeSessionDurable, sessionRevoked } from "../src/lib/receipts-store";

describe("durable revoke", () => {
  it("revokes an in-memory session and persists activated false", async () => {
    const paymentId = `test-durable-${Date.now()}`;
    recordPayment({
      paymentId,
      client: "0xabc",
      agent: { chainId: 97, tokenId: "1", name: "T", receiver: "0x0" },
      activated: true,
      session: { spendCapUsd: 2, expiresAt: new Date(Date.now() + 3600000).toISOString() },
      mode: "sandbox",
      createdAt: new Date().toISOString(),
    } as never);
    expect(await revokeSessionDurable(paymentId)).toBe(true);
    expect(getPayment(paymentId)?.activated).toBe(false);
  });

  it("returns false for an unknown payment", async () => {
    expect(await revokeSessionDurable("does-not-exist")).toBe(false);
  });

  // without a durable store there is no second opinion, so the ledger answer
  // stands and a live session is not hidden on a guess
  it("leaves the ledger answer standing when no receipt is stored", async () => {
    expect(await sessionRevoked("never-stored")).toBe(false);
  });
});
