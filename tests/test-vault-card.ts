// a vault agent's card names the vault as a services entry, the way Vault Hire describes; an agent
// with no vault strategy names none
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("the vault entry on an agent card", () => {
  it("names the chain's vault, the agent address and the strategy", async () => {
    const { vaultService } = await import("../src/lib/vault-card");
    expect(vaultService(56, { wallet: "0xCDfC91c4FEdB9C9F4532F59b3Df43C9EB9A531c0", policy: "band" })).toEqual([
      { name: "vault", endpoint: "eip155:56:0x028816557cb14b8edde51b34d937a063e05cf84e", agent: "0xCDfC91c4FEdB9C9F4532F59b3Df43C9EB9A531c0", policy: "band", executor: "agentsouk" },
    ]);
  });

  it("adds nothing for an agent without a vault strategy or a valid wallet", async () => {
    const { vaultService } = await import("../src/lib/vault-card");
    expect(vaultService(56, { wallet: "0x84FEDaBd1B83443Ad86796C15619494878B64180" })).toEqual([]);
    expect(vaultService(56, { wallet: "nope", policy: "band" })).toEqual([]);
    expect(vaultService(1, { wallet: "0xCDfC91c4FEdB9C9F4532F59b3Df43C9EB9A531c0", policy: "band" })).toEqual([]);
  });
});
