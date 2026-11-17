// A wallet's name and picture change only when the wallet itself asks: the caller replays its
// signed sign-in, and a request without it, or proving another wallet, is refused.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  loadProfile: vi.fn(async () => null),
  saveProfile: vi.fn(async (_w: string, username: string, avatar: string) => ({ username, avatar })),
}));
vi.mock("@/lib/profile-store", () => store);

const proof = vi.hoisted(() => ({
  proofFromHeaders: (h: Headers) => ({ message: h.get("x-agentsouk-message"), signature: h.get("x-agentsouk-signature") }),
  // stands in for the signature check: only the owner's signature proves the owner
  verifyWalletProof: vi.fn(async ({ wallet, signature }: { wallet: string; signature?: string | null }) => signature === `signed-by-${wallet.toLowerCase()}`),
}));
vi.mock("@/lib/wallet-proof", () => proof);

import { PUT } from "../src/app/api/profiles/[wallet]/route";

const owner = "0x84FEDaBd1B83443Ad86796C15619494878B64180";

function put(signature?: string) {
  return new NextRequest(`https://api.agentsouk.xyz/api/profiles/${owner}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(signature ? { "x-agentsouk-message": "bWVzc2FnZQ==", "x-agentsouk-signature": signature } : {}) },
    body: JSON.stringify({ username: "block", avatar: "" }),
  });
}

describe("changing a profile", () => {
  it("is refused without the wallet's sign-in", async () => {
    const res = await PUT(put(), { params: Promise.resolve({ wallet: owner }) });
    expect(res.status).toBe(401);
    expect(store.saveProfile).not.toHaveBeenCalled();
  });

  it("is refused when the proof is another wallet's", async () => {
    const res = await PUT(put("signed-by-0x0000000000000000000000000000000000000001"), { params: Promise.resolve({ wallet: owner }) });
    expect(res.status).toBe(401);
    expect(store.saveProfile).not.toHaveBeenCalled();
  });

  it("is saved when the wallet proves it holds the key", async () => {
    const res = await PUT(put(`signed-by-${owner.toLowerCase()}`), { params: Promise.resolve({ wallet: owner }) });
    expect(res.status).toBe(200);
    expect(store.saveProfile).toHaveBeenCalledWith(owner, "block", "");
  });
});
