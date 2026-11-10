import { describe, expect, it } from "vitest";
import { agentRails } from "../apps/web/src/lib/agent-rails";
import type { AgentDetail } from "../apps/web/src/core/types";
import { ESCROW_FUNDER_BY_CHAIN, VAULT_BY_CHAIN } from "../apps/web/src/lib/contracts";

function detail(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: "56/1",
    agent_id: "1",
    token_id: "1",
    chain_id: 56,
    contract_address: "0x" + "11".repeat(20),
    owner_address: "0x" + "22".repeat(20),
    creator_address: "0x" + "22".repeat(20),
    name: "Test agent",
    description: null,
    agent_wallet: "0x" + "33".repeat(20),
    x402_supported: false,
    image_url: null,
    is_verified: true,
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
    health_checked_at: null,
    quality_score: 0,
    popularity_score: 0,
    activity_score: 0,
    wallet_score: 0,
    freshness_score: 0,
    metadata_completeness_score: 0,
    created_block_number: null,
    created_tx_hash: null,
    is_endpoint_verified: false,
    endpoint_verified_domain: null,
    raw_metadata: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const JOB_SKILLS = [{ id: "negotiate", description: "ERC-8183 job protocol" }];
const VAULT_SKILLS = [{ id: "vault-execution" }];

describe("agent rails", () => {
  it("offers a house job agent our escrow rail", () => {
    const rails = agentRails(
      detail({ skills: JOB_SKILLS, a2a_endpoint: "https://house.example/a2a" }),
      true,
    );
    const job = rails.find((r) => r.kind === "job");
    expect(job?.source).toBe("agent-souk");
  });

  it("opens a third-party job when the seller can be quoted", () => {
    const rails = agentRails(
      detail({ skills: JOB_SKILLS, a2a_endpoint: "https://seller.example/a2a" }),
      false,
    );
    const job = rails.find((r) => r.kind === "job");
    expect(job?.source).toBe("agent");
    expect(rails.map((r) => r.kind)).toEqual(["job"]);
  });

  it("does not offer a call to a job-only seller", () => {
    const rails = agentRails(
      detail({ skills: JOB_SKILLS, a2a_endpoint: "https://seller.example/a2a" }),
      false,
    );
    expect(rails.find((r) => r.kind === "call")).toBeUndefined();
  });

  it("offers both rails to a seller that takes jobs and direct work", () => {
    const rails = agentRails(
      detail({
        skills: [
          { id: "negotiate", description: "ERC-8183 job protocol" },
          { id: "analyze", name: "Analyze a portfolio" },
        ],
        a2a_endpoint: "https://seller.example/a2a",
      }),
      false,
    );
    expect(rails.map((r) => r.kind)).toEqual(["job", "call"]);
  });

  it("offers no rail at all to a third-party job claim with no callable endpoint", () => {
    const rails = agentRails(detail({ skills: JOB_SKILLS }), false);
    expect(rails).toEqual([]);
  });

  it("keeps a job rail off an MCP-only seller, because a quote needs A2A", () => {
    const rails = agentRails(
      detail({ skills: JOB_SKILLS, mcp_server: "https://seller.example/mcp" }),
      false,
    );
    expect(rails.map((r) => r.kind)).toEqual([]);
  });

  it("promotes a third-party job agent that names our escrow", () => {
    const rails = agentRails(
      detail({
        skills: JOB_SKILLS,
        a2a_endpoint: "https://seller.example/a2a",
        raw_metadata: {
          onchain: [
            {
              key: "escrow",
              value: ESCROW_FUNDER_BY_CHAIN[56],
              decoded: null,
            },
          ],
          offchain_uri: null,
          offchain_content: null,
        },
      }),
      false,
    );
    const job = rails.find((r) => r.kind === "job");
    expect(job?.source).toBe("verified");
  });

  it("does not offer a third-party vault claim we do not hold", () => {
    const rails = agentRails(detail({ skills: VAULT_SKILLS }), false);
    expect(rails.find((r) => r.kind === "vault")).toBeUndefined();
  });

  it("promotes a third-party vault agent that names our vault", () => {
    const rails = agentRails(
      detail({
        skills: VAULT_SKILLS,
        services: { vault: VAULT_BY_CHAIN[56] },
      }),
      false,
    );
    const vault = rails.find((r) => r.kind === "vault");
    expect(vault?.source).toBe("verified");
  });

  it("derives every rail from the listing passed in, not a fixed agent", () => {
    const first = agentRails(
      detail({ token_id: "1", skills: JOB_SKILLS, a2a_endpoint: "https://house.example/a2a" }),
      true,
    );
    const second = agentRails(detail({ token_id: "2", skills: VAULT_SKILLS }), true);
    expect(first.map((r) => r.kind)).toEqual(["job"]);
    expect(second.map((r) => r.kind)).toEqual(["vault"]);
  });

  it("renders the rails vault first, then job, then call", () => {
    const rails = agentRails(
      detail({
        skills: [
          { id: "vault-execution" },
          { id: "negotiate", description: "ERC-8183 job protocol" },
          { id: "analyze", name: "Analyze a portfolio" },
        ],
        a2a_endpoint: "https://seller.example/a2a",
        services: { vault: VAULT_BY_CHAIN[56] },
      }),
      false,
    );
    expect(rails.map((r) => r.kind)).toEqual(["vault", "job", "call"]);
  });

  it("offers a call only when an endpoint exists", () => {
    const withEndpoint = agentRails(
      detail({ x402_supported: true, a2a_endpoint: "https://agent.example/a2a" }),
      false,
    );
    expect(withEndpoint.find((r) => r.kind === "call")?.source).toBe("agent");

    const noEndpoint = agentRails(detail({ x402_supported: true }), false);
    expect(noEndpoint.find((r) => r.kind === "call")).toBeUndefined();
  });
});
