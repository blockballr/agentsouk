// A third-party vault agent declares its entry in its own card. The card is a
// claim, so a nonsensical value is ignored; the vault floor still applies and
// the agent's number can only raise it.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { captureAgentSkills, cardVaultMinDeposit } from "../src/lib/agent-interface";

afterEach(() => vi.unstubAllGlobals());

describe("card vault terms", () => {
  it("reads a top-level minimum", () => {
    expect(cardVaultMinDeposit({ vault: { minDepositUsd: 25 } })).toBe(25);
  });

  it("reads one placed on the vault skill", () => {
    expect(cardVaultMinDeposit({ skills: [{ id: "vault_execution", minDepositUsd: 40 }] })).toBe(40);
    expect(cardVaultMinDeposit({ skills: [{ name: "vault-execution", minDepositUsd: 40 }] })).toBe(40);
  });

  it("ignores a value that cannot be a term", () => {
    expect(cardVaultMinDeposit({ vault: { minDepositUsd: 0 } })).toBeNull();
    expect(cardVaultMinDeposit({ vault: { minDepositUsd: -5 } })).toBeNull();
    expect(cardVaultMinDeposit({ vault: { minDepositUsd: "abc" } })).toBeNull();
    expect(cardVaultMinDeposit({ vault: { minDepositUsd: 2_000_000 } })).toBeNull();
    expect(cardVaultMinDeposit(null)).toBeNull();
  });

  it("carries the term out of a live card read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ skills: [{ id: "vault_execution" }], vault: { minDepositUsd: 30 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await captureAgentSkills({ agent_url: "https://agent.example/.well-known/agent-card.json" });
    expect(out?.vaultMinDepositUsd).toBe(30);
  });
});
