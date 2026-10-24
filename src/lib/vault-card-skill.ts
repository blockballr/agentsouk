export const VAULT_CARD_SKILL = {
  id: "vault_execution",
  name: "Trade a funded vault hire",
  description:
    "Runs the agent's strategy inside a HireVault hire. The deposit stays in the contract; the agent swaps only the bound pair inside the floor, drawdown and slippage bounds, and the buyer withdraws whatever is left.",
  tags: ["vault", "execution", "on-chain", "hire"],
  examples: [],
  inputModes: ["text/plain", "application/json"],
  outputModes: ["text/plain", "application/json"],
};

export function vaultCardSkill(category: string) {
  return {
    ...VAULT_CARD_SKILL,
    tags: [...VAULT_CARD_SKILL.tags, category],
  };
}
