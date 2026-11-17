// reads the brain runs itself, beside the MCP tools: the user's own listings, earnings and hires,
// and Flux LP's pool results. each is a plain GET on our own public API, summarised before the
// model sees it. the "my" tools take no address: they read only the conversation's wallet

const API = process.env.ASSISTANT_API_BASE ?? "https://api.agentsouk.xyz/api";
const FLUXLP_POOLS = process.env.ASSISTANT_FLUXLP_POOLS ?? "https://fluxlp.agentsouk.xyz/pools";

const NO_WALLET = {
  error: "no wallet",
  note: "The user has not linked a wallet. In Telegram they send /link; on the website they connect a wallet. Then ask again.",
};

function tool(name: string, description: string) {
  return {
    type: "function" as const,
    function: { name, description, parameters: { type: "object", properties: {}, additionalProperties: false } },
  };
}

export const LOCAL_TOOLS = [
  tool("my_listings", "The agents the user's own wallet lists for sale, with whether each answers its checks. For sellers asking how their agents are doing."),
  tool("my_earnings", "What buyers paid the user's own wallet for its agents: totals per token and the latest payments."),
  tool("my_hires", "The agents the user's own wallet has hired, newest first."),
  tool("fluxlp_pools", "Flux LP's tokenized stock pools ranked by what a wide position earned against simply holding, with fees, the stock's move and how many days are recorded."),
];

export const LOCAL_TOOL_NAMES = new Set(LOCAL_TOOLS.map((t) => t.function.name));

async function getJson(url: string, fetchImpl: typeof fetch): Promise<Record<string, unknown> | null> {
  const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

// raw token units to a short decimal, without floating point on the way
function units(raw: string, decimals: number): number {
  try {
    const big = BigInt(raw);
    const scale = BigInt(10) ** BigInt(Math.max(0, decimals - 6));
    return Number(big / scale) / 10 ** Math.min(decimals, 6);
  } catch {
    return 0;
  }
}

function chainName(chainId: unknown): string {
  return Number(chainId) === 97 ? "testnet" : "mainnet";
}

type Row = Record<string, unknown>;

export function summariseListings(body: Row | null): unknown {
  const agents = (body?.agents as Row[] | undefined) ?? [];
  return {
    count: agents.length,
    agents: agents.slice(0, 12).map((a) => ({
      name: a.name,
      tokenId: a.tokenId,
      network: chainName(a.chainId),
      category: a.category,
      answering: (a.verification as Row | undefined)?.status === "online" ? "yes" : (a.verification as Row | undefined)?.status ?? "not checked yet",
      failingSince: a.failingSince ?? undefined,
      delisted: a.delisted ? "yes" : undefined,
    })),
  };
}

export function summariseEarnings(body: Row | null): unknown {
  const hires = ((body?.hires as Row[] | undefined) ?? []).filter((h) => !String(h.paymentId ?? "").startsWith("verify_"));
  const totals = new Map<string, number>();
  for (const h of hires) {
    const key = `${h.symbol} on ${chainName(h.chainId)}`;
    totals.set(key, (totals.get(key) ?? 0) + units(String(h.amount ?? "0"), Number(h.decimals ?? 18)));
  }
  return {
    payments: hires.length,
    totals: [...totals].map(([asset, amount]) => ({ asset, amount: Number(amount.toFixed(4)) })),
    latest: hires.slice(0, 6).map((h) => ({
      agent: h.agentName,
      amount: Number(units(String(h.amount ?? "0"), Number(h.decimals ?? 18)).toFixed(4)),
      token: h.symbol,
      network: chainName(h.chainId),
      from: h.payer === "team" ? "an Agent Souk team wallet" : "a buyer",
      at: h.createdAt,
    })),
  };
}

export function summariseHires(body: Row | null): unknown {
  const hires = (body?.hires as Row[] | undefined) ?? [];
  return {
    count: hires.length,
    latest: hires.slice(0, 8).map((h) => ({
      agent: h.agentName,
      tokenId: h.tokenId,
      network: chainName(h.chainId),
      at: h.createdAt,
      endsAt: h.expiresAt ?? undefined,
    })),
  };
}

export function summarisePools(body: Row | null): unknown {
  const pools = (body?.pools as Row[] | undefined) ?? [];
  const rows = pools
    .map((p) => ({ p, r: p.result as Row | null }))
    .sort((a, b) => Number(b.r?.vsHoldPer1k ?? -Infinity) - Number(a.r?.vsHoldPer1k ?? -Infinity));
  return {
    measure:
      "endedAgainstHoldingPer1000 is the result: what $1,000 in a range 10% either side of the price ended with against simply holding the two tokens, fees included. feesCollectedPer1000 is only the fees, before the price move. Lead with the result.",
    pools: rows.slice(0, 12).map(({ p, r }) => ({
      pair: p.symbol,
      venue: p.venue,
      ...(r
        ? {
            endedAgainstHoldingPer1000: r.vsHoldPer1k,
            feesCollectedPer1000: r.feesPer1k,
            stockMovePct: r.priceMovePct,
            recordedDays: r.coveredDays,
            label: r.label,
          }
        : { record: "none yet" }),
    })),
    page: "https://fluxlp.agentsouk.xyz",
  };
}

export async function callLocalTool(name: string, wallet: string | null | undefined, fetchImpl: typeof fetch): Promise<string> {
  const mine = name.startsWith("my_");
  if (mine && !(wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet))) return JSON.stringify(NO_WALLET);
  const w = encodeURIComponent(wallet ?? "");
  try {
    switch (name) {
      case "my_listings":
        return JSON.stringify(summariseListings(await getJson(`${API}/agents/by-owner?owner=${w}`, fetchImpl)));
      case "my_earnings":
        return JSON.stringify(summariseEarnings(await getJson(`${API}/hires/by-payee?payee=${w}`, fetchImpl)));
      case "my_hires":
        return JSON.stringify(summariseHires(await getJson(`${API}/hires/by-wallet?wallet=${w}`, fetchImpl)));
      case "fluxlp_pools":
        return JSON.stringify(summarisePools(await getJson(FLUXLP_POOLS, fetchImpl)));
      default:
        return JSON.stringify({ error: `${name} is not available to the assistant` });
    }
  } catch {
    return JSON.stringify({ error: "that read did not answer just now" });
  }
}
