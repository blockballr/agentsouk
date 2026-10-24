// The vault floor is the same for every agent; an agent may ask for more. The
// page reads this so the buyer sees the real entry before signing.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { firstPartyMinDeposit } from "../src/lib/first-party-copy";

describe("agent minimum", () => {
  it("carries the yield agent's higher entry", () => {
    expect(firstPartyMinDeposit(97, "2521")).toBe(25);
  });

  it("carries the grid and band agents' entry", () => {
    expect(firstPartyMinDeposit(97, "2523")).toBe(10);
    expect(firstPartyMinDeposit(97, "2524")).toBe(10);
    expect(firstPartyMinDeposit(97, "2526")).toBe(10);
    expect(firstPartyMinDeposit(97, "2533")).toBe(10);
  });

  it("returns null for an agent that has not declared one", () => {
    expect(firstPartyMinDeposit(56, "999999")).toBeNull();
    expect(firstPartyMinDeposit(97, "999999")).toBeNull();
  });
});
