// A registration admitted at confirm is our own record of the document before any
// index has read it: within the freshness window the lister's declared name, words
// and price flags outrank the index's generated fallbacks, while the chain's own
// facts stay the live read's. After the window the index's read stands again, and
// the endpoint merge works either way.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
});

vi.mock("server-only", () => ({}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});

vi.mock("../src/lib/shelf-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/shelf-store")>();
  return {
    ...actual,
    saveShelfAgents: async () => {},
  };
});

import {
  admitConfirmedAgent,
  getAgentByToken,
  summaryFromRegistration,
} from "../src/lib/scanner";

const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
// the declared owner and the index's read deliberately differ, so an assertion can
// show the chain's facts are not the admission's to overwrite
const DECLARED_OWNER = "0x52DA44aB471455437fc17979c52E501f6b8d0EAF";
const INDEX_OWNER = "0x84fedaBd1b83443aD86796C15619494878B64180";
const CARD = "https://api.agentsouk.xyz/api/house-agent/.well-known/agent-card.json";
const NAME = "Souk Health Guard";
const DESCRIPTION =
  "Computes the health factor of a lending position from the collateral and debt the caller supplies.";

function declaration(tokenId: string) {
  return summaryFromRegistration({
    chainId: 97,
    tokenId,
    owner: DECLARED_OWNER,
    registry: REGISTRY,
    draft: {
      name: NAME,
      description: DESCRIPTION,
      category: "health-factor",
      endpoint: CARD,
      endpointKind: "A2A",
      x402Support: false,
    },
    createdAt: new Date().toISOString(),
  });
}

// what the index serves for a token whose on-chain document it could not read:
// a generated name, no description, and its own default of x402 support
function indexRecord(tokenId: string) {
  return {
    success: true,
    data: {
      id: `idx-${tokenId}`,
      agent_id: `97:${REGISTRY.toLowerCase()}:${tokenId}`,
      token_id: tokenId,
      chain_id: 97,
      contract_address: REGISTRY.toLowerCase(),
      owner_address: INDEX_OWNER,
      creator_address: INDEX_OWNER,
      name: `Agent #${tokenId}`,
      description: null,
      agent_wallet: DECLARED_OWNER,
      x402_supported: true,
      image_url: null,
      is_verified: false,
      is_active: true,
      supported_trust_models: [],
      services: null,
      a2a_endpoint: null,
      mcp_server: null,
      agent_url: null,
      total_feedbacks: 0,
      total_validations: 0,
      successful_validations: 0,
      average_score: 0,
      total_score: 0,
      health_score: null,
      health_status: null,
      created_at: "2026-10-16T11:20:41Z",
      raw_metadata: {
        offchain_uri: `https://api.agentsouk.xyz/api/agents/register/unread-${tokenId}`,
        offchain_content: null,
      },
    },
  };
}

function stubIndex(tokenId: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(indexRecord(tokenId)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

beforeEach(() => {
  // the admission reads the card through fetch first; a404 leaves it without skills
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a listing admitted before the index has read the document", () => {
  it("serves the declared words and price flags over the index's fallbacks", async () => {
    await admitConfirmedAgent(declaration("9711"));
    stubIndex("9711");

    const read = await getAgentByToken(97, "9711");

    expect(read?.name).toBe(NAME);
    expect(read?.description).toBe(DESCRIPTION);
    expect(read?.x402_supported).toBe(false);
    // the chain's own facts stay the live read's
    expect(read?.owner_address).toBe(INDEX_OWNER);
    // the endpoint merge runs beside it, fresh or not
    expect(read?.a2a_endpoint).toBe(CARD);
  });

  it("lets the index's read stand once the freshness window has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T00:00:00Z"));
    await admitConfirmedAgent(declaration("9712"));
    vi.setSystemTime(new Date("2026-10-17T01:00:00Z"));
    stubIndex("9712");

    const read = await getAgentByToken(97, "9712");

    expect(read?.name).toBe("Agent #9712");
    expect(read?.x402_supported).toBe(true);
    // the endpoint merge is not freshness-gated: it fills what the live read lacks
    expect(read?.a2a_endpoint).toBe(CARD);
  });
});
