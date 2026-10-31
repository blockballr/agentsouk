import { describe, expect, it } from "vitest";
import { snapshotServingAllowed } from "../src/lib/snapshot-policy";

describe("snapshot policy", () => {
  it("never serves a committed file in production", () => {
    expect(snapshotServingAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows it only with the explicit local flag", () => {
    expect(snapshotServingAllowed({ NODE_ENV: "production", SHELF_SNAPSHOT: "on" })).toBe(true);
  });

  it("allows it in tests and local work", () => {
    expect(snapshotServingAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(snapshotServingAllowed({})).toBe(true);
  });
});
