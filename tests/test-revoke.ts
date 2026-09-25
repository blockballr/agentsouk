import { describe, it, expect } from "vitest";
import { recordPayment, listActiveSessions, revokeSession } from "../src/lib/x402";

describe("revoke", () => {
  it("revoked sessions leave the active list", () => {
    const paymentId = `test-${Date.now()}`;
    recordPayment({
      paymentId,
      client: "0xabc",
      agent: { chainId: 97, tokenId: "1", name: "T", receiver: "0x0" },
      activated: true,
      session: { spendCapUsd: 2, expiresAt: new Date(Date.now() + 3600000).toISOString() },
      mode: "sandbox",
      createdAt: new Date().toISOString(),
    } as never);
    expect(listActiveSessions().some((s) => s.paymentId === paymentId)).toBe(true);
    expect(revokeSession(paymentId)).toBe(true);
    expect(listActiveSessions().some((s) => s.paymentId === paymentId)).toBe(false);
  });
});
