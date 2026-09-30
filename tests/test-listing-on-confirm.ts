// Admission at confirmation: once the chain has proven the registration, the
// agent goes on the shelf immediately under the same gate a live read passes,
// instead of waiting on a third-party indexer. A refusal explains itself and
// never fails the confirmation, which is a chain fact. Only the chain read and
// the durable write are cut here; the claim store, the classifier and the shelf
// gate are the real implementations.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Env before any module resolves its client or its chain.
const env = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
  return {
    REGISTRY: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
    OWNER: "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862",
    TRANSFER: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    agentUri: "",
    owner: "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862",
    calldata: "0x" as `0x${string}`,
    tokenId: "4242",
  };
});

// The durable write is the only shared-store edge; capture it instead of opening
// a connection, so the test can assert what the fleet would receive.
const shelfWrites = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("server-only", () => ({}));

// The route reads a receipt, the signed-over calldata and the registry's own
// tokenURI/ownerOf. Replace that one client; the proof logic stays real.
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  const word = (hex: string) => `0x${hex.padStart(64, "0")}`;
  return {
    ...actual,
    createPublicClient: () => ({
      getTransactionReceipt: async () => ({
        status: "success",
        to: actual.getAddress(env.REGISTRY),
        logs: [
          {
            address: actual.getAddress(env.REGISTRY),
            topics: [
              env.TRANSFER,
              `0x${"0".repeat(64)}`,
              word(env.owner.slice(2)),
              word(BigInt(env.tokenId).toString(16)),
            ],
          },
        ],
      }),
      getTransaction: async () => ({ input: env.calldata }),
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "tokenURI" ? env.agentUri : env.owner,
    }),
  };
});

vi.mock("../src/lib/shelf-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/shelf-store")>();
  return {
    ...actual,
    saveShelfAgents: async (summaries: unknown[]) => {
      shelfWrites.calls.push(summaries);
    },
  };
});

// No request scope here, so after() has nothing to schedule; this keeps a
// browse from reaching the network for a live top up.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});

import { NextRequest } from "next/server";
import { POST } from "../src/app/api/agents/register/confirm/route";
import { createClaim, newClaimId } from "../src/lib/listing-claims";
import {
  encodeRegister,
  registrationUrl,
  type RegistrationDraft,
} from "../src/lib/registry-write";
import { isShelfReady } from "../src/lib/agent-index";
import {
  getAgentByToken,
  queryAgents,
  shelfRefusalReason,
  summaryFromRegistration,
} from "../src/lib/scanner";
import type { AgentSummary } from "../src/lib/types";

const BASE = "https://api.agentsouk.xyz";
const TX = `0x${"ab".repeat(32)}` as const;

const QUALIFYING: RegistrationDraft = {
  name: "Venus Health Sentinel",
  description: "Watches a wallet health factor and acts before liquidation on Venus.",
  category: "health-factor",
  endpoint: "https://sentinel.example/.well-known/agent-card.json",
  endpointKind: "A2A",
};

async function prepareClaim(draft: RegistrationDraft, tokenId: string) {
  const claimId = newClaimId();
  const agentUri = registrationUrl(BASE, claimId);
  const claim = await createClaim({
    claimId,
    chainId: 97,
    owner: env.OWNER,
    agentUri,
    draft,
  });
  // the fake client reads whichever claim is being confirmed right now
  env.agentUri = agentUri;
  env.owner = env.OWNER;
  env.tokenId = tokenId;
  env.calldata = encodeRegister(97, agentUri);
  return claim;
}

async function confirm(claimId: string, tokenId: string) {
  const req = new NextRequest("http://localhost/api/agents/register/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimId, agentId: tokenId, txHash: TX }),
  });
  const res = await POST(req);
  return { res, body: await res.json() };
}

beforeEach(() => {
  shelfWrites.calls.length = 0;
  const emptyPage = {
    ok: true,
    json: async () => ({
      success: true,
      data: [],
      meta: { pagination: { page: 1, limit: 100, total: 0, hasMore: false } },
    }),
  };
  vi.stubGlobal("fetch", vi.fn(async () => emptyPage));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a proven registration is shelved at confirmation", () => {
  it("admits a qualifying agent and serves it without waiting for the indexer", async () => {
    const claim = await prepareClaim(QUALIFYING, "4242");
    const { res, body } = await confirm(claim.claimId, "4242");

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.verified).toBe(true);
    expect(body.listed).toBe(true);
    expect(body.listingReason).toBeNull();

    // the instance that handled the confirmation serves it now
    const catalogue = await queryAgents({ q: "Venus Health Sentinel", limit: 10 });
    expect(catalogue.items.some((a) => a.token_id === "4242")).toBe(true);

    // and it reached the shared store, not only this process
    expect(shelfWrites.calls).toHaveLength(1);
    const [written] = shelfWrites.calls[0] as AgentSummary[];
    expect(written.token_id).toBe("4242");
    expect(written.chain_id).toBe(97);
    expect(written.category).toBe("health-factor");
    expect(written.a2a_endpoint).toBe(QUALIFYING.endpoint);
  });

  // the wizard probes the listing seconds after confirming it, and 8004scan
  // answers not-found until it indexes the token; that read evicted the agent
  it("keeps a fresh admission when the index answers not-found", async () => {
    const draft = { ...QUALIFYING, name: "Venus Lag Sentinel" };
    const claim = await prepareClaim(draft, "4250");
    const { body } = await confirm(claim.claimId, "4250");
    expect(body.listed).toBe(true);
    const [written] = shelfWrites.calls[0] as AgentSummary[];
    expect(written.admitted_at).toBeTruthy();

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    expect((await getAgentByToken(97, "4250"))?.token_id).toBe("4250");
    const catalogue = await queryAgents({ q: "Venus Lag Sentinel", limit: 10 });
    expect(catalogue.items.some((a) => a.token_id === "4250")).toBe(true);
  });

  it("refuses an unreachable endpoint with a reason and still confirms", async () => {
    const draft: RegistrationDraft = {
      ...QUALIFYING,
      endpoint: "http://localhost:8080/.well-known/agent-card.json",
    };
    const claim = await prepareClaim(draft, "4244");
    const { res, body } = await confirm(claim.claimId, "4244");

    // the chain fact is confirmed regardless of what the shelf decides
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe("confirmed");
    expect(body.listed).toBe(false);
    expect(String(body.listingReason)).toMatch(/not publicly reachable/);
    expect(String(body.listingReason)).toMatch(/localhost/);

    const catalogue = await queryAgents({ q: "Venus Health Sentinel", limit: 10 });
    expect(catalogue.items.some((a) => a.token_id === "4244")).toBe(false);
  });

  it("files an unclassified agent under the category its lister chose", async () => {
    const draft: RegistrationDraft = {
      ...QUALIFYING,
      name: "Helper Bot",
      description: "A general purpose assistant that answers anything at all.",
      endpoint: "https://helper.example/a2a",
    };
    const claim = await prepareClaim(draft, "4245");
    const { res, body } = await confirm(claim.claimId, "4245");

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.listed).toBe(true);
    expect(body.listingReason).toBeNull();

    const catalogue = await queryAgents({ q: "Helper Bot", limit: 10 });
    const filed = catalogue.items.find((a) => a.token_id === "4245");
    expect(filed).toBeTruthy();
    expect(filed?.category).toBe("health-factor");
  });

  it("refuses a claim that carries no category, with a reason, and still confirms", async () => {
    const draft: RegistrationDraft = {
      ...QUALIFYING,
      name: "Helper Bot",
      description: "A general purpose assistant that answers anything at all.",
      endpoint: "https://helper.example/a2a",
      // a claim from before the form required a category to file under
      category: undefined as unknown as RegistrationDraft["category"],
    };
    const claim = await prepareClaim(draft, "4246");
    const { res, body } = await confirm(claim.claimId, "4246");

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.listed).toBe(false);
    expect(String(body.listingReason)).toMatch(/general/);

    const catalogue = await queryAgents({ q: "Helper Bot", limit: 10 });
    expect(catalogue.items.some((a) => a.token_id === "4246")).toBe(false);
  });
});

describe("the summary built from a confirmed claim", () => {
  it("keys the shelf entry to the minted token and the registry", () => {
    const s = summaryFromRegistration({
      chainId: 97,
      tokenId: "4242",
      owner: env.OWNER,
      registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      draft: QUALIFYING,
      createdAt: "2026-09-27T00:00:00.000Z",
    });
    expect(s.agent_id).toBe(`97:${env.REGISTRY}:4242`);
    expect(s.contract_address).toBe(env.REGISTRY);
    expect(s.a2a_endpoint).toBe(QUALIFYING.endpoint);
    expect(s.mcp_server).toBeNull();
    expect(s.category).toBe("health-factor");
    expect(s.x402_supported).toBe(true);
  });

  it("shelves a web service, carried as browser-invoked rather than mislabelled", () => {
    const s = summaryFromRegistration({
      chainId: 97,
      tokenId: "1",
      owner: env.OWNER,
      registry: env.REGISTRY,
      draft: { ...QUALIFYING, endpointKind: "web" },
      createdAt: "2026-09-27T00:00:00.000Z",
    });
    expect(s.a2a_endpoint).toBeNull();
    expect(s.mcp_server).toBeNull();
    expect(s.web_endpoint).toBe(QUALIFYING.endpoint);
    expect(isShelfReady(s)).toBe(true);
  });

  it("files an agent under the category its lister chose, whatever the text reads", () => {
    const s = summaryFromRegistration({
      chainId: 97,
      tokenId: "2",
      owner: env.OWNER,
      registry: env.REGISTRY,
      draft: {
        ...QUALIFYING,
        name: "Helper Bot",
        description: "A general purpose assistant that answers anything at all.",
      },
      createdAt: "2026-09-27T00:00:00.000Z",
    });
    expect(s.category).toBe("health-factor");
    expect(s.declared_category).toBe("health-factor");
    expect(isShelfReady(s)).toBe(true);
  });

  it("names the classifier when a claim carries no category at all", () => {
    const s = summaryFromRegistration({
      chainId: 97,
      tokenId: "2",
      owner: env.OWNER,
      registry: env.REGISTRY,
      draft: {
        ...QUALIFYING,
        name: "Helper Bot",
        description: "A general purpose assistant that answers anything at all.",
        // a claim from before the form required a category to file under
        category: undefined as unknown as RegistrationDraft["category"],
      },
      createdAt: "2026-09-27T00:00:00.000Z",
    });
    expect(shelfRefusalReason(s)).toMatch(/general/);
  });
});
