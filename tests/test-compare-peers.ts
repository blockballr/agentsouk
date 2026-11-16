import { describe, expect, it } from "vitest";
import { cardCompleteness, rankPeers, searchTermsFor, type PeerCandidate } from "../src/lib/peer-rank";
import { summarizeProviderJobs, type IndexedJob } from "../src/lib/job-stats";

const subject: PeerCandidate = {
  token_id: "1",
  chain_id: 56,
  name: "Souk Grid Planner",
  description: "Plans a grid ladder for BNB against USDT and trades it",
  owner_address: "0xaaa",
  x402_supported: true,
  category: "grid-trading",
  categoryScores: { "grid-trading": 6 },
};

function peer(id: string, over: Partial<PeerCandidate>): PeerCandidate {
  return { token_id: id, chain_id: 56, name: `Agent ${id}`, description: "", owner_address: `0x${id}`, ...over };
}

describe("peer finder", () => {
  it("keeps same-category agents, drops the owner's own and name duplicates", () => {
    const ranked = rankPeers(subject, [
      peer("2", { category: "grid-trading", categoryScores: { "grid-trading": 5 }, description: "grid ladder trading for BNB" }),
      peer("3", { category: "grid-trading", owner_address: "0xaaa" }),
      peer("4", { category: "yield", description: "stable yield" }),
      peer("5", { name: "Souk Grid Planner", category: "grid-trading" }),
      peer("6", { category: "grid-trading" }),
    ]);
    expect(ranked.map((p) => p.token_id)).toEqual(["2", "6"]);
  });

  it("searches by the category, or by the name when there is none", () => {
    expect(searchTermsFor("yield", "x")).toContain("yield");
    expect(searchTermsFor(undefined, "Venus Liquidation Shield")).toEqual(["venus", "liquidation", "shield"]);
  });

  it("names what a card is missing", () => {
    const c = cardCompleteness({ description: "short", a2a_endpoint: "https://x", skills: [] });
    expect(c.have).toBe(1);
    expect(c.missing).toEqual(["a description", "an image", "skills", "a wallet"]);
  });
});

describe("a seller's jobs", () => {
  const job = (id: number, client: string, status: number, budget = "100", expiredAt = 0): IndexedJob => ({
    chainId: 56, jobId: id, client, provider: "0xp", budget, status, expiredAt, submittedAt: 0,
  });

  it("counts outcomes, settled value and repeat buyers", () => {
    const s = summarizeProviderJobs(
      [job(1, "a", 3), job(2, "a", 3), job(3, "b", 3), job(4, "b", 4), job(5, "c", 1, "100", 50), job(6, "c", 1, "100", 500)],
      100,
    );
    expect(s).toEqual({ total: 6, completed: 3, rejected: 1, expired: 1, inProgress: 1, settled: "300", buyers: 3, repeatBuyers: 1 });
  });
});

describe("results on record", () => {
  it("says plainly when Flux LP has only dry runs", async () => {
    const { describeFluxDecisions } = await import("../src/lib/agent-results");
    expect(describeFluxDecisions([{ mode: "dry", action: "exit" }])).toBe("1 decision logged, all dry runs; no live action yet");
    expect(describeFluxDecisions([{ mode: "live" }, { mode: "dry" }])).toBe("2 decisions logged, 1 acted on chain");
    expect(describeFluxDecisions([])).toBe("No decisions logged yet");
  });

  it("counts vault trades across hires", async () => {
    const { describeVaultReceipts } = await import("../src/lib/agent-results");
    const r = (hireId: string, status: string) => ({ hireId, status });
    expect(describeVaultReceipts([r("13", "traded"), r("13", "traded"), r("12", "skipped")])).toBe(
      "2 trades across 2 vault hires, 1 check without a trade",
    );
    expect(describeVaultReceipts([])).toBeNull();
  });
});
