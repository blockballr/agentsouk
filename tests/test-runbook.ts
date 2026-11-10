// The runbook is the live plan, so it must come from the same tool surface and
// the same registry state the server serves, and it must never drift.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildRunbook } from "../src/lib/runbook";
import { RUNBOOK_INTENTS, isRunbookIntent } from "../src/lib/runbook-intents";
import { MCP_TOOLS } from "../src/lib/mcp-tools";
import { GET as manifest } from "../src/app/.well-known/agentsouk.json/route";

const TOOLS = new Set(MCP_TOOLS.map((tool) => tool.name));

const detail = {
  token_id: "391002",
  name: "Souk Band Keeper",
  chain_id: 56,
  owner_address: "0x84FEDaBd1B83443Ad86796C15619494878B64180",
  agent_wallet: "0xCDfC91c4FEdB9C9F4532F59b3Df43C9EB9A531c0",
  a2a_endpoint: "https://api.example/a2a",
  mcp_server: null,
  x402_supported: true,
  availability: { phase: "live", shelf: true, hireable: true, quotable: true, reason: null },
  skills: [{ id: "vault-execution" }],
  vault: { policy: "band", executor: "agent" },
};

describe("the runbook is the live plan", () => {
  it("builds every intent from tools the server serves", () => {
    for (const intent of RUNBOOK_INTENTS) {
      const book = buildRunbook({ intent, chainId: 56 });
      expect(book.steps.length, intent).toBeGreaterThan(0);
      for (const step of book.steps) {
        if (step.tool) expect(TOOLS.has(step.tool), `${intent}: ${step.tool}`).toBe(true);
      }
      expect(book.markdown, intent).toContain(`# Runbook: ${intent}`);
      expect(book.docs).toMatch(/^reference\/[a-z0-9-]+\.md$/);
    }
  });

  it("tailors the plan to one agent", () => {
    const book = buildRunbook({ intent: "vault", chainId: 56, detail });
    expect(book.agent).toMatchObject({
      tokenId: "391002",
      name: "Souk Band Keeper",
      executor: "agent",
      policy: "band",
      endpoint: "https://api.example/a2a",
    });
    expect(book.agent?.rails).toEqual(["vault", "x402"]);
    expect(book.markdown).toContain("Souk Band Keeper");
    expect(book.markdown).toContain("executor: agent");
  });

  it("says why an agent cannot take work", () => {
    const book = buildRunbook({
      intent: "hire",
      chainId: 56,
      detail: {
        ...detail,
        availability: { phase: "delisted", shelf: false, hireable: false, quotable: false, reason: "Delisted." },
      },
    });
    expect(book.refusals).toContain("Delisted.");
  });

  it("marks a first-party agent as swept here", () => {
    const book = buildRunbook({
      intent: "vault",
      chainId: 56,
      detail: { ...detail, vault: null, skills: [] },
      firstParty: { policy: "band", tokenId: "391002" },
    });
    expect(book.agent?.executor).toBe("soukdio");
    expect(book.agent?.policy).toBe("band");
  });

  it("never carries a testnet plan", () => {
    const all = RUNBOOK_INTENTS.map((intent) => buildRunbook({ intent, chainId: 56 }).markdown).join("\n");
    expect(all).not.toContain("eip155:97");
    expect(all).not.toContain("sUSD");
  });

  it("rejects an unknown intent", () => {
    expect(isRunbookIntent("hire")).toBe(true);
    expect(isRunbookIntent("mint")).toBe(false);
  });
});

describe("the well-known manifest", () => {
  it("names the chain, the tools and the runbook", async () => {
    const body = await (await manifest()).json();
    expect(body.chainId).toBe(56);
    expect(body.settlement.symbol).toBeTruthy();
    expect(body.mcp.tools).toHaveLength(MCP_TOOLS.length);
    expect(body.mcp.tools.map((tool: { name: string }) => tool.name)).toContain("get_runbook");
    expect(body.runbook.intents).toEqual([...RUNBOOK_INTENTS]);
    expect(body.docs).toBe("/skill");
  });
});
