// the prepared vault hire: an exact approval then the open, refusals passed through as sentences,
// and nothing prepared for an address that is not a wallet
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decodeFunctionData, parseAbi } from "viem";
import { CliError } from "../packages/cli/src/core/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ clientIpFrom: () => "t", enforceRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));

const vault = "0x028816557cb14b8edde51b34d937a063e05cf84e";
const usdt = "0x55d398326f99059fF775485246999027B3197955";
const agent = "0xCDfC91c4FEdB9C9F4532F59b3Df43C9EB9A531c0";
const buyer = "0x84FEDaBd1B83443Ad86796C15619494878B64180";

const planner = vi.hoisted(() => ({ planVaultHire: vi.fn() }));
vi.mock("../packages/cli/src/marketplace/vault-hire", async (orig) => ({ ...(await orig<object>()), ...planner }));

function plan(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 56, tokenId: "391002", agentName: "Souk Band Keeper", agentWallet: agent, executor: "soukdio", vault, client: buyer,
    token: { address: usdt, symbol: "USDT", decimals: 18 }, amount: 5n * 10n ** 18n, amountText: "5", expiry: 1795105172,
    expiryIso: "2026-11-19T16:19:32.000Z", slippageBps: 500, fee: 500, agentFeeBps: 0, maxLossBps: 2000,
    venue: "0x0000000000000000000000000000000000000000", needsApprove: true, wrapWei: 0n, ...overrides,
  };
}

const ABI = parseAbi([
  "function approve(address,uint256)",
  "function open(address,address,uint256,uint64,uint16,uint24,uint16,uint16,address)",
]);

async function call(query: string) {
  const { GET } = await import("../src/app/api/vault/prepare/route");
  const res = await GET(new NextRequest(`https://api.agentsouk.xyz/api/vault/prepare?${query}`));
  return { status: res.status, body: await res.json() };
}

describe("preparing a vault hire for a wallet that sends raw calls", () => {
  it("approves exactly the deposit, then opens", async () => {
    planner.planVaultHire.mockResolvedValueOnce(plan());
    const { status, body } = await call(`agent=56/391002&buyer=${buyer}&deposit=5`);
    expect(status).toBe(200);
    expect(body.calls.map((c: { step: string }) => c.step)).toEqual(["approve", "open"]);
    const approve = decodeFunctionData({ abi: ABI, data: body.calls[0].data });
    expect(approve.args).toEqual([expect.stringMatching(new RegExp(vault, "i")), 5n * 10n ** 18n]);
    const open = decodeFunctionData({ abi: ABI, data: body.calls[1].data });
    expect(String(open.args[0]).toLowerCase()).toBe(agent.toLowerCase());
    expect(open.args[2]).toBe(5n * 10n ** 18n);
    expect(body.calls[1].to).toBe(vault);
  });

  it("skips the approval when the allowance already covers the deposit", async () => {
    planner.planVaultHire.mockResolvedValueOnce(plan({ needsApprove: false }));
    const { body } = await call(`agent=391002&buyer=${buyer}&deposit=5`);
    expect(body.calls.map((c: { step: string }) => c.step)).toEqual(["open"]);
  });

  it("passes a planner refusal back as a sentence", async () => {
    planner.planVaultHire.mockRejectedValueOnce(new CliError("the vault refuses a deposit under 1 USDT", "under_floor"));
    const { status, body } = await call(`agent=56/391002&buyer=${buyer}&deposit=0.1`);
    expect(status).toBe(400);
    expect(body).toMatchObject({ success: false, code: "under_floor" });
  });

  it("prepares nothing for an address that is not a wallet", async () => {
    planner.planVaultHire.mockClear();
    const { status } = await call("agent=56/391002&buyer=alice.ai&deposit=5");
    expect(status).toBe(400);
    expect(planner.planVaultHire).not.toHaveBeenCalled();
  });
});
