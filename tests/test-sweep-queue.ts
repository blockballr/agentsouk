// A fresh listing jumps the sweep queue; the merge below is the contract that
// decides who gets swept. Without a database both store calls fail closed, so
// the queue is empty and confirmation never depends on it.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mergeSweepCandidates } from "../src/app/api/cron/verify/route";
import {
  enqueueSweep as storeEnqueue,
  takeSweepQueue as storeTake,
} from "../src/lib/verifications-store";

const agents = [
  { token_id: 1, name: "A", category: "yield", chain_id: 97 },
  { token_id: 2, name: "B", category: "grid-trading", chain_id: 97 },
  { token_id: 3, name: "C", category: "rebalancing", chain_id: 56 },
  { token_id: 4, name: "D", category: "health-factor", chain_id: 97 },
];

describe("sweep candidate merge", () => {
  it("leads with queued tokens and fills by score within the limit", () => {
    const out = mergeSweepCandidates(
      [{ tokenId: "99", name: "New", category: "yield" }],
      agents,
      97,
      3,
    );
    expect(out.map((c) => c.tokenId)).toEqual(["99", "1", "2"]);
    expect(out[0]).toMatchObject({ chainId: 97, name: "New", category: "yield" });
  });

  it("never duplicates a queued token and never exceeds the limit", () => {
    const out = mergeSweepCandidates(
      [
        { tokenId: "1", name: "A", category: "yield" },
        { tokenId: "2", name: "B", category: "grid-trading" },
        { tokenId: "4", name: "D", category: "health-factor" },
      ],
      agents,
      97,
      3,
    );
    expect(out.map((c) => c.tokenId)).toEqual(["1", "2", "4"]);
  });

  it("prefers tokens still waiting on their first probe", () => {
    const out = mergeSweepCandidates(
      [],
      [
        { token_id: 1, name: "A", category: "yield", chain_id: 97 },
        { token_id: 2, name: "B", category: "grid-trading", chain_id: 97 },
      ],
      97,
      5,
      new Set(["1"]),
    );
    expect(out.map((c) => c.tokenId)).toEqual(["2", "1"]);
  });

  it("excludes other chains and defaults a missing category", () => {
    const out = mergeSweepCandidates([], [{ token_id: 5, name: "E", chain_id: 56 }], 97, 5);
    expect(out).toEqual([]);
    const out2 = mergeSweepCandidates([], [{ token_id: 6, name: "F", chain_id: 97 }], 97, 5);
    expect(out2[0]).toMatchObject({ tokenId: "6", category: "general" });
  });
});

describe("sweep queue store without a database", () => {
  it("fails closed without throwing", async () => {
    await expect(storeEnqueue("1", "A", "yield")).resolves.toBe(false);
    await expect(storeTake(3)).resolves.toEqual([]);
  });
});
