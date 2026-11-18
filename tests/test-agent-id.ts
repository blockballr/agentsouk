// Agent ID: the .ai handle comes from the token's metadata address, a wallet reads only its own name,
// and a non-holder is answered as such.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const lookups = vi.hoisted(() => ({ agentIdOf: vi.fn(async (_a: string) => ({ holder: true, handle: "fagos" })) }));
vi.mock("@/lib/agent-id", async (orig) => ({ ...(await orig<typeof import("../src/lib/agent-id")>()), agentIdOf: lookups.agentIdOf }));

const proof = vi.hoisted(() => ({
  proofFromHeaders: (h: Headers) => ({ message: h.get("x-agentsouk-message"), signature: h.get("x-agentsouk-signature") }),
  verifyWalletProof: vi.fn(async ({ wallet, signature }: { wallet: string; signature?: string | null }) => signature === `signed-by-${wallet.toLowerCase()}`),
}));
vi.mock("@/lib/wallet-proof", () => proof);

const wallet = "0x042A000000000000000000000000000000fa9c00";

describe("reading an Agent ID", () => {
  it("takes the handle from the metadata address, and nothing else", async () => {
    const { handleFromUri } = await import("../src/lib/agent-id");
    expect(handleFromUri("https://agentid.prd.space.id/metadata/fagos.json")).toBe("fagos");
    expect(handleFromUri("https://agentid.prd.space.id/metadata/Kimooo.json")).toBe("kimooo");
    expect(handleFromUri("https://example.com/other.png")).toBeNull();
  });

  it("answers a wallet its own name once it proves it holds the key", async () => {
    const { GET } = await import("../src/app/api/agent-id/me/route");
    const res = await GET(
      new NextRequest(`https://api.agentsouk.xyz/api/agent-id/me?wallet=${wallet}`, {
        headers: { "x-agentsouk-message": "bWVzc2FnZQ==", "x-agentsouk-signature": `signed-by-${wallet.toLowerCase()}` },
      }),
    );
    expect(await res.json()).toMatchObject({ success: true, holder: true, name: "fagos.ai" });
  });

  it("refuses to name a wallet for anyone who has not proven they hold it", async () => {
    lookups.agentIdOf.mockClear();
    const { GET } = await import("../src/app/api/agent-id/me/route");
    const res = await GET(
      new NextRequest(`https://api.agentsouk.xyz/api/agent-id/me?wallet=${wallet}`, {
        headers: { "x-agentsouk-message": "bWVzc2FnZQ==", "x-agentsouk-signature": "signed-by-someone-else" },
      }),
    );
    expect(res.status).toBe(401);
    expect(lookups.agentIdOf).not.toHaveBeenCalled();
  });
});
