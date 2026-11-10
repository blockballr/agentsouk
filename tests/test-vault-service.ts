// A card may say which vault policy it runs; it may never say this marketplace
// runs it, because only a first-party agent is in our executor set.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isVaultPolicy, readVaultService } from "../src/lib/vault-service";

describe("the vault service a card declares", () => {
  it("reads the object form this marketplace writes", () => {
    expect(readVaultService({ vault: { policy: "band", executor: "agent" } })).toEqual({ policy: "band", executor: "agent" });
    expect(readVaultService({ x402: { endpoint: "https://x" }, vault: { policy: "grid" } })).toEqual({ policy: "grid", executor: "agent" });
  });

  it("reads the ERC-8004 list form", () => {
    expect(readVaultService([{ name: "vault", policy: "buffer" }, { name: "x402" }])).toEqual({ policy: "buffer", executor: "agent" });
    expect(readVaultService([{ name: "web", endpoint: "https://x" }])).toBeNull();
  });

  it("refuses an unknown policy", () => {
    expect(readVaultService({ vault: { policy: "moon" } })).toBeNull();
    expect(readVaultService({ vault: { policy: "" } })).toBeNull();
  });

  it("never lets a card claim the marketplace executes it", () => {
    expect(readVaultService({ vault: { policy: "band", executor: "soukdio" } })).toEqual({ policy: "band", executor: "agent" });
  });

  it("ignores anything that is not a vault entry", () => {
    for (const services of [null, undefined, {}, [], "vault", { vault: "band" }, { vault: ["band"] }]) {
      expect(readVaultService(services)).toBeNull();
    }
  });

  it("knows the policies a sweep can run", () => {
    for (const policy of ["porter", "band", "buffer", "grid"]) expect(isVaultPolicy(policy)).toBe(true);
    for (const other of ["Band", "moon", "", null, 7]) expect(isVaultPolicy(other)).toBe(false);
  });
});
