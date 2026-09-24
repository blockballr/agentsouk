import { describe, it, expect } from "vitest";
import {
  dedupeKey,
  hasCallableEndpoint,
  isScoutSpam,
  normalizedName,
  probeToVerification,
  SCOUT_KEYWORDS,
} from "../src/lib/scout-pipeline-core";
import type { ScoutCandidate } from "../src/lib/scout";

describe("scout pipeline helpers", () => {
  it("has all four category keyword buckets", () => {
    expect(Object.keys(SCOUT_KEYWORDS).sort()).toEqual(
      ["grid-trading", "health-factor", "rebalancing", "yield"].sort(),
    );
  });

  it("normalizes batch names for dedupe", () => {
    expect(normalizedName("Grid Bot 123")).toBe("gridbot");
    expect(normalizedName("BORT Liquidity Bloom #10966")).toBe("bortliquiditybloom");
  });

  it("dedupe key pairs name with owner", () => {
    expect(dedupeKey({ name: "Grid Bot 12", owner_address: "0xABC" })).toBe("gridbot:0xabc");
  });

  it("spam cohorts are filtered", () => {
    expect(isScoutSpam({ name: "Ensoul #12", description: null })).toBe(true);
    expect(isScoutSpam({ name: "Jarvis", description: "DeFi agent" })).toBe(false);
  });

  it("callable endpoint requires mcp or a2a", () => {
    expect(hasCallableEndpoint({ mcp_server: "https://x/mcp" })).toBe(true);
    expect(hasCallableEndpoint({ a2a_endpoint: "https://x/card" })).toBe(true);
    expect(hasCallableEndpoint({ agent_url: "https://x" })).toBe(false);
  });

  it("probe verdict maps to verification status", () => {
    const cand: ScoutCandidate = {
      agent_id: "56:reg:1",
      token_id: "1",
      chain_id: 56,
      name: "Bot",
      description: null,
      category: "yield",
      endpoint: "https://x",
      endpointType: "mcp",
      source: "keyword",
      discoveredAt: new Date().toISOString(),
    };
    const ok = probeToVerification(cand, { tokenId: "1", ok: true, detail: "mcp initialize ok", protocol: "mcp" }, 100);
    expect(ok.status).toBe("delivered");
    const dead = probeToVerification(cand, { tokenId: "1", ok: false, detail: "mcp 502", protocol: "mcp" }, 100);
    expect(dead.status).toBe("dead");
  });
});
