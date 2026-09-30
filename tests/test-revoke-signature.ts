// A paymentId and its client are public through the hires-per-wallet API, and a
// revoke drops the hire from the buyer's quest progress, so the route must
// refuse anyone who cannot sign as the wallet that hired.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("../src/lib/receipts-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/receipts-store")>();
  return { ...actual, cancelAuthorizationDurable: async () => ({ attempted: false }) };
});

import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { revokeRequestMessage } from "@agora/core";
import { DELETE } from "../src/app/api/sessions/route";
import { getPayment, recordPayment } from "../src/lib/x402";

const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const stranger = privateKeyToAccount(`0x${"22".repeat(32)}`);

function hire(paymentId: string) {
  recordPayment({
    paymentId,
    client: buyer.address,
    agent: { chainId: 97, tokenId: "2504", name: "Souk Health Guard", receiver: "0x0" },
    activated: true,
    session: { spendCapUsd: 5, expiresAt: new Date(Date.now() + 3600000).toISOString() },
    mode: "prod",
    createdAt: new Date().toISOString(),
  } as never);
}

function revoke(paymentId: string, body: Record<string, unknown>) {
  return DELETE(
    new NextRequest(`http://localhost/api/sessions?paymentId=${paymentId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("signed session revoke", () => {
  it("refuses a revoke that names the client but carries no signature", async () => {
    hire("pay_unsigned");
    const res = await revoke("pay_unsigned", { client: buyer.address });
    expect(res.status).toBe(401);
    expect(getPayment("pay_unsigned")?.activated).toBe(true);
  });

  it("refuses a stranger's signature over the same message", async () => {
    hire("pay_stranger");
    const signature = await stranger.signMessage({ message: revokeRequestMessage("pay_stranger", buyer.address) });
    const res = await revoke("pay_stranger", { client: buyer.address, signature });
    expect(res.status).toBe(403);
    expect(getPayment("pay_stranger")?.activated).toBe(true);
  });

  it("refuses the buyer's signature for a different session", async () => {
    hire("pay_target");
    const signature = await buyer.signMessage({ message: revokeRequestMessage("pay_other", buyer.address) });
    const res = await revoke("pay_target", { client: buyer.address, signature });
    expect(res.status).toBe(403);
    expect(getPayment("pay_target")?.activated).toBe(true);
  });

  it("revokes when the buyer signs for this session", async () => {
    hire("pay_signed");
    const signature = await buyer.signMessage({ message: revokeRequestMessage("pay_signed", buyer.address) });
    const res = await revoke("pay_signed", { client: buyer.address, signature });
    expect(res.status).toBe(200);
    expect(getPayment("pay_signed")?.activated).toBe(false);
  });
});
