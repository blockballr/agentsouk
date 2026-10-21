import "server-only";

// The on-chain half of a listing: an agent that only answers is a directory
// entry; an agent that acts is a worker. The brief counts the wallet's own
// contract calls, not plain transfers, approvals, registry writes or job
// deliveries, so this reads the wallet's transactions and keeps only the
// calls that look like work.
//
// BscScan's account API is the practical source: an EVM RPC has no
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

const SCAN: Record<number, string> = {
  56: "https://api.bscscan.com/api",
  97: "https://api-testnet.bscscan.com/api",
};

// Methods that are bookkeeping rather than the agent's job.
const APPROVAL = /^0x095ea7b3/i;
const TRANSFER = /^0xa9059cbb/i;
const REGISTRY = new Set([
  "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", // ERC-8004 mainnet
  "0x8004a818bfb912233c491871b3d84c89a494bd9e", // ERC-8004 testnet
]);
// ERC-8183 deliveries and the marketplace's own rails are not "acting".
const DELIVERY = new Set([
  "0xea4daa3100a767e86fded867729ae7446476eba6", // AgenticCommerce mainnet
  "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de", // AgenticCommerce testnet
  "0x51895229e12f9876011789b04f8698af06ccd6da", // EvaluatorRouter mainnet
  "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25", // EvaluatorRouter testnet
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
  const method = tx.methodId ?? input.slice(0, 10);
  if (APPROVAL.test(method) || TRANSFER.test(method)) return false;
  const to = (tx.to ?? "").toLowerCase();
  if (REGISTRY.has(to) || DELIVERY.has(to)) return false;
  return true;
}

export async function readWalletActivity(
  chainId: number,
  wallet: string,
): Promise<WalletActivity> {
  const key = `${chainId}:${wallet.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const api = SCAN[chainId];
  if (!api) return empty(wallet, chainId, `no explorer is configured for chain ${chainId}`);
  const apiKey = process.env.BSCSCAN_API_KEY;
  if (!apiKey) return empty(wallet, chainId, "BSCSCAN_API_KEY is not configured");

  let txs: ScanTx[] = [];
  try {
    const url = `${api}?module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=200&sort=desc&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = (await res.json()) as { status?: string; result?: ScanTx[] | string; message?: string };
    if (body.status !== "1" || !Array.isArray(body.result)) {
      return empty(wallet, chainId, typeof body.result === "string" ? body.result : body.message ?? "explorer read failed");
    }
    txs = body.result;
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
