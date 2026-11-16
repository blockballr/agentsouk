// what an agent has actually done, where the marketplace can see it: trades
// receipted in vault hires, the Health Guard's repays, Flux LP's logged
// decisions. an outside agent's results are not visible to us, so it gets null

import "server-only";
import { countNotificationsByKind } from "@/lib/durable-store";
import { houseAgentTokenId } from "@/lib/house-agent";
import { receiptsForAgent } from "@/lib/receipt-store";

export interface AgentResult {
  line: string;
  source: string;
}

const FLUX_LP_TOKEN = "406220";
const FLUX_LP_DECISIONS = "https://fluxlp.agentsouk.xyz/decisions";

export function describeFluxDecisions(entries: { mode?: string; action?: string }[]): string {
  if (entries.length === 0) return "No decisions logged yet";
  const live = entries.filter((e) => e.mode && e.mode !== "dry").length;
  const noun = entries.length === 1 ? "decision" : "decisions";
  if (live === 0) return `${entries.length} ${noun} logged, all dry runs; no live action yet`;
  return `${entries.length} ${noun} logged, ${live} acted on chain`;
}

export function describeVaultReceipts(receipts: { status: string; hireId: string }[]): string | null {
  if (receipts.length === 0) return null;
  const traded = receipts.filter((r) => r.status === "traded");
  const hires = new Set(receipts.map((r) => r.hireId)).size;
  const checks = receipts.length - traded.length;
  return `${traded.length} ${traded.length === 1 ? "trade" : "trades"} across ${hires} vault ${hires === 1 ? "hire" : "hires"}, ${checks} ${checks === 1 ? "check" : "checks"} without a trade`;
}

export async function resultsFor(chainId: number, tokenId: string, agentWallet: string | null): Promise<AgentResult | null> {
  if (tokenId === FLUX_LP_TOKEN) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(FLUX_LP_DECISIONS, { headers: { accept: "application/json" }, signal: ctl.signal }).finally(() => clearTimeout(timer));
      const body = (await res.json()) as { entries?: { mode?: string; action?: string }[] };
      return { line: describeFluxDecisions(body.entries ?? []), source: "Flux LP's public decision log" };
    } catch {
      return null;
    }
  }
  if (Number(tokenId) === houseAgentTokenId(chainId)) {
    const repays = await countNotificationsByKind("health_repaid");
    if (repays === null) return null;
    return { line: repays === 0 ? "No repays needed yet" : `${repays} ${repays === 1 ? "repay" : "repays"} on Venus`, source: "The guard's repay notices" };
  }
  if (agentWallet) {
    const receipts = await receiptsForAgent(agentWallet, 500).catch(() => []);
    const line = describeVaultReceipts(receipts);
    if (line) return { line, source: "The vault's execution receipts" };
  }
  return null;
}
