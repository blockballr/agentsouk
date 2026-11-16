// One stream of what agents actually did, for the homepage, /proof and each
// agent page. A row only exists when a transaction backs it: a dry run, a
// skip, a refusal or a payment without a hash never becomes proof.

export type FeedRail = "vault" | "escrow" | "x402";

export interface FeedItem {
  at: string;
  agentName: string;
  tokenId: string | null;
  rail: FeedRail;
  /** a hire is money paid to the agent; a trade is the agent moving a hire's funds */
  kind: "hire" | "trade";
  amount: string | null;
  symbol: string | null;
  txHash: string;
  detail: string;
}

// a paid call settled over x402. the stored mode names the facilitator that
// settled it, not the rail, so every row here is a paid call
export interface HireRow {
  at: string;
  agentName: string;
  tokenId: string;
  amount: string;
  symbol: string;
  txHash: string | null;
}

export interface TradeReceiptRow {
  createdAt: string;
  agent: string;
  hireId: string;
  status: string;
  txHash: string | null;
}

export interface KnownAgent {
  tokenId: string;
  name: string | null;
  wallet: string;
}

const TX = /^0x[0-9a-fA-F]{64}$/;

export function buildProofFeed(input: {
  hires: HireRow[];
  trades: TradeReceiptRow[];
  agents: KnownAgent[];
  limit: number;
  tokenId?: string | null;
}): FeedItem[] {
  const byWallet = new Map(input.agents.map((a) => [a.wallet.toLowerCase(), a]));
  const items: FeedItem[] = [];

  for (const hire of input.hires) {
    if (!hire.txHash || !TX.test(hire.txHash)) continue;
    items.push({
      at: hire.at,
      agentName: hire.agentName,
      tokenId: hire.tokenId,
      rail: "x402",
      kind: "hire",
      amount: hire.amount,
      symbol: hire.symbol,
      txHash: hire.txHash,
      detail: "Paid call, settled on delivery",
    });
  }

  for (const trade of input.trades) {
    if (trade.status !== "traded" || !trade.txHash || !TX.test(trade.txHash)) continue;
    const agent = byWallet.get(trade.agent.toLowerCase());
    items.push({
      at: trade.createdAt,
      agentName: agent?.name ?? "Vault agent",
      tokenId: agent?.tokenId ?? null,
      rail: "vault",
      kind: "trade",
      amount: null,
      symbol: null,
      txHash: trade.txHash,
      detail: `Traded inside vault hire #${trade.hireId}`,
    });
  }

  // the same transaction can reach us twice, for example a retried record
  const seen = new Set<string>();
  return items
    .filter((item) => (input.tokenId ? item.tokenId === input.tokenId : true))
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((item) => {
      const key = item.txHash.toLowerCase() + item.kind;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, input.limit);
}

// settlements are 18 decimal stables; an amount that is not a wei string is
// shown as it came rather than guessed at
export function settledAmount(raw: string): string {
  try {
    const value = Number(BigInt(raw)) / 1e18;
    if (!Number.isFinite(value)) return raw;
    if (value === 0) return "0";
    return value < 1 ? value.toFixed(4) : value.toFixed(2);
  } catch {
    return raw;
  }
}
