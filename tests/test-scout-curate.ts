import { describe, it, expect } from "vitest";
import { shouldAddCandidate } from "../src/lib/scout-curate-core";

describe("scout auto-curate rules", () => {
  it("skips agents already on the shelf", () => {
    expect(
      shouldAddCandidate({
        candidate: { token_id: "1", category: "yield" },
        verification: { status: "delivered" },
        existingTokenIds: new Set(["1"]),
        categoryCounts: {},
      }),
    ).toBe(false);
  });

  it("requires delivered verification", () => {
    expect(
      shouldAddCandidate({
        candidate: { token_id: "2", category: "yield" },
        verification: { status: "dead" },
        existingTokenIds: new Set(),
        categoryCounts: {},
      }),
    ).toBe(false);
  });

  it("adds delivered specialists not yet listed", () => {
    expect(
      shouldAddCandidate({
        candidate: { token_id: "3", category: "grid-trading" },
        verification: { status: "delivered" },
        existingTokenIds: new Set(["1"]),
        categoryCounts: { "grid-trading": 2 },
      }),
    ).toBe(true);
  });

  it("caps category growth", () => {
    expect(
      shouldAddCandidate({
        candidate: { token_id: "4", category: "rebalancing" },
        verification: { status: "delivered" },
        existingTokenIds: new Set(),
        categoryCounts: { rebalancing: 55 },
      }),
    ).toBe(false);
  });
});
