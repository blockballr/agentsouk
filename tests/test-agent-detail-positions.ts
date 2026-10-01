// the agent page's PancakeSwap positions: read from the wallet the agent registered and
// never the owner's, and shown only when there is at least one position to show
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const AGENT_WALLET = "0x84fedabd1b83443ad86796c15619494878b64180";
const OWNER = "0x1111111111111111111111111111111111111111";

const m = vi.hoisted(() => ({
  agent: {} as Record<string, unknown>,
  shelf: [] as Record<string, unknown>[],
  readPancakePositions: vi.fn(),
}));

vi.mock("@/lib/scanner", () => ({
  getAgentByToken: async () => m.agent,
  queryAgents: async () => ({ items: m.shelf }),
}));
vi.mock("@/lib/verifications", () => ({ loadVerifications: async () => new Map() }));
vi.mock("@/lib/pancakeswap", () => ({ isPancakeSwapAgent: () => false, readsPancakeSwap: () => false }));
vi.mock("@/lib/x402", () => ({ findActiveSession: () => undefined }));
vi.mock("@/lib/receipts-store", () => ({ sessionRevoked: async () => false }));
vi.mock("@/lib/boosts", () => ({ getBoost: () => undefined, hydrateBoostsFromDb: async () => {} }));
vi.mock("@/lib/delivery", () => ({ fetchAgentCardSkills: async () => null }));
vi.mock("@/lib/pancake-positions", () => ({ readPancakePositions: m.readPancakePositions }));

afterEach(() => {
  vi.clearAllMocks();
  m.shelf = [];
});

async function detail(agent: Record<string, unknown>) {
  m.agent = { token_id: "2491", name: "Agent", description: "", skills: [], owner_address: OWNER, ...agent };
  const { GET } = await import("../src/app/api/agents/[chainId]/[tokenId]/route");
  const res = await GET(new NextRequest("https://api.agentsouk.xyz/api/agents/97/2491"), {
    params: Promise.resolve({ chainId: "97", tokenId: "2491" }),
  });
  return ((await res.json()) as { data: Record<string, unknown> }).data;
}

const positions = (held: number, staked: number) => ({
  wallet: AGENT_WALLET,
  held,
  staked,
  positionManager: "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
  checkedAt: "2026-09-30T12:00:00.000Z",
});

describe("agent page PancakeSwap positions", () => {
  it("reads the agent's registered wallet and shows what it has", async () => {
    m.readPancakePositions.mockResolvedValue(positions(0, 2));
    const data = await detail({ agent_wallet: AGENT_WALLET });
    expect(m.readPancakePositions).toHaveBeenCalledWith(97, AGENT_WALLET);
    expect(data.pancakeswapPositions).toMatchObject({ held: 0, staked: 2 });
  });

  it("does not fall back to the owner when the agent registered no wallet", async () => {
    m.readPancakePositions.mockResolvedValue(null);
    const data = await detail({ agent_wallet: null });
    expect(m.readPancakePositions).toHaveBeenCalledWith(97, null);
    expect(data).not.toHaveProperty("pancakeswapPositions");
  });

  it("says nothing for an empty wallet or a failed read", async () => {
    for (const answer of [positions(0, 0), null]) {
      m.readPancakePositions.mockResolvedValue(answer);
      expect(await detail({ agent_wallet: AGENT_WALLET })).not.toHaveProperty("pancakeswapPositions");
    }
  });
});

// the shelf's category is the tab a listing sits under, which the quest counts by
describe("agent page category", () => {
  it("carries the shelf's category for a listed agent", async () => {
    m.readPancakePositions.mockResolvedValue(null);
    m.shelf = [{ token_id: "2491", category: "yield" }];
    expect((await detail({})).category).toBe("yield");
  });

  it("says nothing for an agent the shelf does not hold", async () => {
    m.readPancakePositions.mockResolvedValue(null);
    m.shelf = [{ token_id: "9999", category: "yield" }];
    expect(await detail({})).not.toHaveProperty("category");
  });
});
