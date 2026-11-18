import { VAULT_BY_CHAIN } from "@/lib/vault";

// the Vault Hire services entry: the vault as a CAIP-10 account, the address a buyer names at opening,
// and who runs it. the vault comes from the table the executor sweeps, so the card cannot drift from it
export function vaultService(chainId: number, row: { wallet?: string; policy?: string }): Record<string, string>[] {
  const vault = VAULT_BY_CHAIN[chainId];
  if (!row.policy || !vault || !row.wallet || !/^0x[0-9a-fA-F]{40}$/.test(row.wallet)) return [];
  return [{ name: "vault", endpoint: `eip155:${chainId}:${vault}`, agent: row.wallet, policy: row.policy, executor: "agentsouk" }];
}
