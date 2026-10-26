import "server-only";

// The on-chain half of a listing: an agent that only answers is a directory
// entry; an agent that acts is a worker. The brief counts the wallet's own
// contract calls, excluding plain transfers, approvals and registry writes.
// Job submissions (ERC-8183 deliveries) and other contract calls count as work,
// since those are the agent acting on chain.
//
// Ankr advanced API is the practical source: an EVM RPC has no
// "transactions by address" method. The key stays server-side.

export interface WalletActivity {
  available: boolean;
  wallet: string;
  chainId: number;
  actions: number;
  days: number;
  lastAt: string | null;
  qualified: boolean;
  reason?: string;
}

// Ankr advanced API: free tier (200M credits/month) covers BSC (56) and its
// testnet (97). Auth is the API key in the URL path; the chain is selected
// per request via the `blockchain` param.
const ANKR_CHAIN: Record<number, string> = {
  56: "bsc",
  97: "bsc_testnet",
};

// Methods that are bookkeeping rather than the agent's job.
const APPROVAL = /^0x095ea7b3/i;
const TRANSFER = /^0xa9059cbb/i;
// Registry writes (registration) are bookkeeping, not work. Job submissions
// (the agent delivering against an ERC-8183 job) ARE the agent acting, so the
// commerce contract is deliberately NOT excluded here.
const REGISTRY = new Set([
  "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", // ERC-8004 mainnet
  "0x8004a818bfb912233c491871b3d84c89a494bd9e", // ERC-8004 testnet
]);

interface ScanTx {
  timeStamp?: string;
  to?: string;
  input?: string;
  isError?: string;
  methodId?: string;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: WalletActivity }>();

function empty(wallet: string, chainId: number, reason: string): WalletActivity {
  return { available: false, wallet, chainId, actions: 0, days: 0, lastAt: null, qualified: false, reason };
}

function looksLikeWork(tx: ScanTx): boolean {
  if (tx.isError === "1") return false;
  const input = tx.input ?? "";
  if (!input || input === "0x") return false;
  const method = (tx.methodId ?? input.slice(0, 10)).toLowerCase();
  if (APPROVAL.test(method) || TRANSFER.test(method)) return false;
  if (method.includes("transfer") || method.includes("approve")) return false;
  const to = (tx.to ?? "").toLowerCase();
  if (REGISTRY.has(to)) return false;
  return true;
}

export async function readWalletActivity(
  chainId: number,
  wallet: string,
): Promise<WalletActivity> {
  const key = `${chainId}:${wallet.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const ankrChain = ANKR_CHAIN[chainId];
  if (!ankrChain) return empty(wallet, chainId, `no explorer is configured for chain ${chainId}`);
  const apiKey = process.env.ANKR_API_KEY;
  if (!apiKey) return empty(wallet, chainId, "ANKR_API_KEY is not configured");

  let txs: ScanTx[] = [];
  try {
    const url = `https://rpc.ankr.com/multichain/${apiKey}`;
    const body = {
      jsonrpc: "2.0",
      method: "ankr_getTransactionsByAddress",
      params: { address: wallet, blockchain: [ankrChain], pageSize: 200 },
      id: 1,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let parsed: { result?: { transactions?: Array<{ timestamp?: string | number; to?: string; to_address?: string; input?: string; isError?: string; status?: number | string; method?: string }> }; error?: { message?: string } };
    try {
      parsed = JSON.parse(text) as { result?: { transactions?: Array<{ timestamp?: string | number; to?: string; to_address?: string; input?: string; isError?: string; status?: number | string; method?: string }> }; error?: { message?: string } };
    } catch {
      return empty(wallet, chainId, `explorer returned a non-JSON answer (${res.status})`);
    }
    if (parsed.error) {
      return empty(wallet, chainId, parsed.error.message ?? "explorer read failed");
    }
    const list = parsed.result?.transactions;
    if (!Array.isArray(list)) {
      txs = [];
    } else {
      txs = list.map((t) => {
        const tsRaw = t.timestamp;
        const ts = typeof tsRaw === "number" ? tsRaw : (typeof tsRaw === "string" ? (tsRaw.startsWith("0x") ? parseInt(tsRaw, 16) : (Number.isFinite(Number(tsRaw)) ? Number(tsRaw) : Math.floor(new Date(tsRaw).getTime() / 1000))) : NaN);
        const input = t.input ?? "";
        const status = t.status;
        const failed = status === "0x0" || status === 0 || status === "0" || status === "0x0";
        const isError = t.isError === "1" || failed ? "1" : "0";
        const to = (t.to ?? t.to_address ?? "").toLowerCase();
        const method = t.method ?? input.slice(0, 10);
        return {
          timeStamp: Number.isFinite(ts) ? String(ts) : undefined,
          to: to || undefined,
          input: input || undefined,
          isError,
          methodId: method || undefined,
        };
      });
    }
  } catch (e) {
    return empty(wallet, chainId, e instanceof Error ? e.message : "explorer read failed");
  }

  const work = txs.filter(looksLikeWork);
  const daySet = new Set<string>();
  let lastAt: string | null = null;
  for (const tx of work) {
    const ts = Number(tx.timeStamp);
    if (!Number.isFinite(ts)) continue;
    const iso = new Date(ts * 1000).toISOString();
    daySet.add(iso.slice(0, 10));
    if (!lastAt || iso > lastAt) lastAt = iso;
  }

  const value: WalletActivity = {
    available: true,
    wallet,
    chainId,
    actions: work.length,
    days: daySet.size,
    lastAt,
    qualified: work.length >= 5 && daySet.size >= 3,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
