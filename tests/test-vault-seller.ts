// The capability the shelf filters on is published in two spellings: the cards
// we serve use the underscore, the first-party registry uses the hyphen. Both
// name the same hire lane, so the predicate has to accept either.
import { describe, expect, it } from "vitest";
import { takesVault, VAULT_SKILL_ID } from "@agora/core";

describe("takesVault", () => {
  it("accepts the underscore form the cards publish", () => {
    expect(takesVault([{ id: "vault_execution" }])).toBe(true);
  });

  it("accepts the hyphen form the registry uses", () => {
    expect(takesVault([{ id: "vault-execution" }])).toBe(true);
  });

  it("accepts a name when the id is absent", () => {
    expect(takesVault([{ name: "Vault_Execution" }])).toBe(true);
  });

  it("refuses an agent that only mentions the word", () => {
    expect(takesVault([{ id: "plan_grid", description: "suggests a vault execution plan" }])).toBe(false);
    expect(takesVault([])).toBe(false);
    expect(takesVault(null)).toBe(false);
  });

  it("exports the canonical id", () => {
    expect(VAULT_SKILL_ID).toBe("vault-execution");
  });
});
