// "Working first" rotates the agents that delivered, so the team's own agents stop holding the
// top of every category, and the house switch takes them off only where others can stand in
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "../src/lib/types";
import {
  MIN_THIRD_PARTY_WORKING,
  rotationSeed,
  withoutHouseAgents,
  workingFirst,
} from "../src/lib/working-rotation";

const HOUSE = "0x84fedabd1b83443ad86796c15619494878b64180";

function agent(tokenId: string, score: number, owner = `0x${tokenId.padStart(40, "1")}`, category = "grid-trading"): AgentSummary {
  return { token_id: tokenId, total_score: score, total_feedbacks: 0, owner_address: owner, category } as AgentSummary;
}

const house = agent("2522", 99, HOUSE);
const working = [house, agent("3001", 10), agent("3002", 20), agent("3003", 30), agent("3004", 40)];
const gated = agent("4001", 90);
const dead = agent("4002", 95);
const verifications = new Map<string, { status?: string }>([
  ...working.map((a) => [a.token_id, { status: "delivered" }] as const),
  ["4001", { status: "gated" }],
  ["4002", { status: "dead" }],
]);

describe("working first", () => {
  it("keeps every working agent ahead of the rest, whatever their scores", () => {
    const order = workingFirst([dead, gated, ...working], verifications, "visit-a").map((a) => a.token_id);
    expect(order.slice(0, 5).sort()).toEqual(working.map((a) => a.token_id).sort());
    expect(order.slice(5)).toEqual(["4001", "4002"]);
  });

  it("gives one visit a stable order and different visits different leaders", () => {
    const a = workingFirst(working, verifications, "visit-a").map((x) => x.token_id);
    expect(workingFirst([...working].reverse(), verifications, "visit-a").map((x) => x.token_id)).toEqual(a);
    const leaders = new Set(
      Array.from({ length: 40 }, (_, i) => workingFirst(working, verifications, `visit-${i}`)[0].token_id),
    );
    expect(leaders.size).toBeGreaterThan(2);
  });

  it("gives neighbouring token ids a fair share of first place", () => {
    const ids = Array.from({ length: 30 }, (_, i) => agent(String(3100 + i), 10));
    const v = new Map(ids.map((a) => [a.token_id, { status: "delivered" }] as const));
    const firsts = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const lead = workingFirst(ids, v, `visit-${i}`)[0].token_id;
      firsts.set(lead, (firsts.get(lead) ?? 0) + 1);
    }
    // 100 each is fair; a biased hash gave some ids a quarter and others two and a half times that
    const counts = ids.map((a) => firsts.get(a.token_id) ?? 0);
    expect(Math.min(...counts)).toBeGreaterThan(60);
    expect(Math.max(...counts)).toBeLessThan(150);
  });

  it("takes a well formed seed as given and turns an absent one over hourly", () => {
    expect(rotationSeed("abc_123")).toBe("abc_123");
    expect(rotationSeed("../etc")).toBe(rotationSeed(null));
    expect(rotationSeed(null, 3_600_000 * 5)).not.toBe(rotationSeed(null, 3_600_000 * 6));
  });
});

describe("house agents switch", () => {
  it("lists everything unless the switch is set to 0", () => {
    expect(withoutHouseAgents(working, verifications, {})).toHaveLength(working.length);
  });

  it("takes a house agent off only where enough working agents of other owners remain", () => {
    expect(working.length - 1).toBeGreaterThanOrEqual(MIN_THIRD_PARTY_WORKING);
    const off = withoutHouseAgents(working, verifications, { HOUSE_AGENTS_LISTED: "0" });
    expect(off.map((a) => a.token_id)).not.toContain("2522");

    const thin = [house, agent("3001", 10), agent("3002", 20)];
    const kept = withoutHouseAgents(thin, verifications, { HOUSE_AGENTS_LISTED: "0" });
    expect(kept.map((a) => a.token_id)).toContain("2522");
  });

  it("counts a category's working agents on their own, not the whole shelf's", () => {
    const yieldHouse = agent("2600", 99, HOUSE, "yield");
    const shelf = [...working, yieldHouse];
    const v = new Map(verifications).set("2600", { status: "delivered" });
    const off = withoutHouseAgents(shelf, v, { HOUSE_AGENTS_LISTED: "0" }).map((a) => a.token_id);
    expect(off).toContain("2600");
    expect(off).not.toContain("2522");
  });
});
