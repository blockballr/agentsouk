import { describe, it, expect, vi } from "vitest";

// receipts-store.ts carries the "server-only" marker, which throws outside a
// server bundle; the marker is a build guard, not part of the logic under test
vi.mock("server-only", () => ({}));

import { recordPayment, getPayment, type StoredPayment } from "../src/lib/x402";
import {
  planAuthorizationCancel,
  cancelAuthorization,
  cancellationResultFromOutcome,
  cancelAuthorizationDurable,
  revokeSessionDurable,
  type CancelBroadcast,
  type CancelOutcome,
  type CancellationPlan,
} from "../src/lib/receipts-store";

const SUSD = "0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53";
const AUTHORIZER = "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713";
const NONCE = `0x${"ab".repeat(32)}`;
const PAYEE = "0x0000000000000000000000000000000000000001";
const TX_HASH = `0x${"cd".repeat(32)}` as `0x${string}`;

let seq = 0;

function storedPayment(overrides: Partial<StoredPayment> = {}): StoredPayment {
  seq += 1;
  const base: StoredPayment = {
    paymentId: `test-cancel-${seq}`,
    createdAt: new Date().toISOString(),
    txHash: `0x${"00".repeat(32)}`,
    mode: "prod",
    agent: { chainId: 97, tokenId: "1", name: "T" },
    client: AUTHORIZER,
    payTo: PAYEE,
    amount: "1000000000000000000",
    symbol: "sUSD",
    activated: true,
    session: {
      spendCapUsd: 2,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    paymentPayload: {
      x402Version: 2,
      payload: {
        authorization: {
          from: AUTHORIZER,
          to: PAYEE,
          value: "1000000000000000000",
          validAfter: "0",
          validBefore: String(Math.floor(Date.now() / 1000) + 3600),
          nonce: NONCE,
          signature: `0x${"11".repeat(65)}`,
        },
        resource: { url: "https://example.test/agent", description: "x", mimeType: "application/json" },
      },
      resource: { url: "https://example.test/agent", description: "x", mimeType: "application/json" },
      accepted: {
        scheme: "exact",
        network: "eip155:97",
        amount: "1000000000000000000",
        asset: SUSD,
        payTo: PAYEE,
        maxTimeoutSeconds: 300,
        extra: { name: "Agent Souk Test USD", version: "1", assetTransferMethod: "eip3009" },
      },
    },
  };
  return { ...base, ...overrides };
}

function recordingBroadcast(outcome: CancelOutcome): {
  broadcast: CancelBroadcast;
  calls: CancellationPlan[];
} {
  const calls: CancellationPlan[] = [];
  const broadcast: CancelBroadcast = async (plan) => {
    calls.push(plan);
    return outcome;
  };
  return { broadcast, calls };
}

describe("planAuthorizationCancel", () => {
  it("plans a cancellation for a stored EIP-3009 authorization", () => {
    const planned = planAuthorizationCancel(storedPayment());
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.chainId).toBe(97);
    expect(planned.plan.asset.toLowerCase()).toBe(SUSD.toLowerCase());
    expect(planned.plan.authorizer).toBe(AUTHORIZER);
    expect(planned.plan.nonce).toBe(NONCE);
  });

  it("reports no plan when the stored payload is missing", () => {
    const planned = planAuthorizationCancel(storedPayment({ paymentPayload: undefined }));
    expect(planned).toEqual({ ok: false, reason: "no stored authorization" });
  });

  it("reports no plan when the authorization has no nonce", () => {
    const p = storedPayment();
    p.paymentPayload!.payload.authorization.nonce = "";
    const planned = planAuthorizationCancel(p);
    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    expect(planned.reason).toContain("nonce");
  });

  it("refuses a token that is not the settlement asset", () => {
    const p = storedPayment();
    p.paymentPayload!.accepted.asset = "0x000000000000000000000000000000000000dEaD";
    const planned = planAuthorizationCancel(p);
    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    expect(planned.reason).toContain("settlement asset");
  });

  it("refuses a chain with no configured settlement asset", () => {
    const p = storedPayment();
    p.paymentPayload!.accepted.network = "eip155:1";
    const planned = planAuthorizationCancel(p);
    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    expect(planned.reason).toContain("no settlement asset");
  });
});

describe("cancelAuthorization", () => {
  it("returns the cancellation transaction hash on success", async () => {
    const { broadcast, calls } = recordingBroadcast({ kind: "success", hash: TX_HASH });
    const result = await cancelAuthorization(storedPayment(), broadcast);
    expect(result.attempted).toBe(true);
    expect(result.canceled).toBe(true);
    expect(result.txHash).toBe(TX_HASH);
    expect(result.chainId).toBe(97);
    expect(calls).toHaveLength(1);
  });

  it("returns an honest failure without pretending a cancellation happened", async () => {
    const { broadcast } = recordingBroadcast({ kind: "failed", error: "relay key absent" });
    const result = await cancelAuthorization(storedPayment(), broadcast);
    expect(result.attempted).toBe(true);
    expect(result.canceled).toBe(false);
    expect(result.txHash).toBeUndefined();
    expect(result.error).toContain("relay key absent");
  });

  it("treats a throwing broadcast as a reported failure, not a crash", async () => {
    const broadcast: CancelBroadcast = async () => {
      throw new Error("rpc down");
    };
    const result = await cancelAuthorization(storedPayment(), broadcast);
    expect(result.attempted).toBe(true);
    expect(result.canceled).toBe(false);
    expect(result.error).toContain("rpc down");
  });

  it("does not broadcast when there is no stored authorization", async () => {
    const { broadcast, calls } = recordingBroadcast({ kind: "success", hash: TX_HASH });
    const result = await cancelAuthorization(
      storedPayment({ paymentPayload: undefined }),
      broadcast,
    );
    expect(calls).toHaveLength(0);
    expect(result.attempted).toBe(false);
    expect(result.canceled).toBe(false);
    expect(result.error).toContain("no stored authorization");
  });
});

describe("cancellationResultFromOutcome", () => {
  it("maps an already revoked nonce to a cancellation without a new transaction", () => {
    const result = cancellationResultFromOutcome({ kind: "already-revoked" }, 97);
    expect(result.canceled).toBe(true);
    expect(result.alreadyRevoked).toBe(true);
    expect(result.attempted).toBe(false);
    expect(result.txHash).toBeUndefined();
  });
});

describe("revoke keeps the ledger honest when cancellation cannot happen", () => {
  it("revokes the ledger even when the broadcast fails", async () => {
    const p = storedPayment();
    recordPayment(p);
    const { broadcast } = recordingBroadcast({ kind: "failed", error: "broadcast unavailable" });
    const result = await cancelAuthorizationDurable(p.paymentId, broadcast);
    expect(result.canceled).toBe(false);
    expect(result.error).toContain("broadcast unavailable");
    expect(await revokeSessionDurable(p.paymentId)).toBe(true);
    expect(getPayment(p.paymentId)?.activated).toBe(false);
  });

  it("reports a missing authorization instead of a cancellation", async () => {
    const p = storedPayment({ paymentPayload: undefined });
    recordPayment(p);
    const { broadcast, calls } = recordingBroadcast({ kind: "success", hash: TX_HASH });
    const result = await cancelAuthorizationDurable(p.paymentId, broadcast);
    expect(result.attempted).toBe(false);
    expect(result.canceled).toBe(false);
    expect(result.error).toContain("no stored authorization");
    expect(calls).toHaveLength(0);
  });

  it("reports an unknown payment without broadcasting", async () => {
    const { broadcast, calls } = recordingBroadcast({ kind: "success", hash: TX_HASH });
    const result = await cancelAuthorizationDurable("missing-payment", broadcast);
    expect(result.canceled).toBe(false);
    expect(result.error).toContain("unknown paymentId");
    expect(calls).toHaveLength(0);
  });
});
