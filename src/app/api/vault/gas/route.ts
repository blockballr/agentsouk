import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { vaultFor } from "@/lib/vault";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";
import { estimateRoundTrip } from "@/lib/vault-gas";

export const dynamic = "force-dynamic";

const OPENED = parseAbiItem(
  "event Opened(uint256 indexed id, address indexed buyer, address indexed agent, address token, uint256 amount, uint64 expiry, uint16 maxSlippageBps, uint16 agentFeeBps, uint16 maxLossBps)",
);
const CLOSED = parseAbiItem(
  "event Closed(uint256 indexed id, address indexed buyer, address indexed agent, uint256 balanceA, uint256 balanceB, uint256 deployedB, uint256 agentFee)",
);

// public log endpoints cap the block range, so the window is walked backwards in
// chunks until the sample is full or the budget is spent. the last twenty events
// are all the form needs.
const CHUNK = 50_000n;
const MAX_CHUNKS = 12;
const SAMPLE = 20;

// a dedicated read endpoint: the shared transport is not required to serve logs
function logEndpoint(chainId: number): string {
  if (chainId === BSC_TESTNET_CHAIN_ID) {
    return process.env.VAULT_LOG_RPC_97 ?? "https://bsc-testnet-rpc.publicnode.com";
  }
  return process.env.VAULT_LOG_RPC_56 ?? "https://bsc-rpc.publicnode.com";
}

type Client = ReturnType<typeof createPublicClient>;

async function collectLogs(
  client: Client,
  vault: `0x${string}`,
  event: typeof OPENED | typeof CLOSED,
  head: bigint,
): Promise<{ transactionHash: `0x${string}` }[]> {
  const out: { transactionHash: `0x${string}` }[] = [];
  let to = head;
  for (let i = 0; i < MAX_CHUNKS && out.length < SAMPLE; i += 1) {
    const from = to > CHUNK ? to - CHUNK : 0n;
    try {
      const logs = await client.getLogs({ address: vault, event, fromBlock: from, toBlock: to });
      out.unshift(...(logs as { transactionHash: `0x${string}` }[]));
    } catch {
      // the node refused the range; stop with what is already collected
      break;
    }
    if (from === 0n) break;
    to = from - 1n;
  }
  return out.slice(-SAMPLE);
}

async function averageGas(client: Client, logs: { transactionHash: `0x${string}` }[]): Promise<{ gas: number | null; samples: number }> {
  const recent = logs.slice(-SAMPLE);
  const receipts = await Promise.all(
    recent.map((log) => client.getTransactionReceipt({ hash: log.transactionHash }).catch(() => null)),
  );
  const used = receipts.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => Number(r.gasUsed));
  if (used.length === 0) return { gas: null, samples: 0 };
  return { gas: used.reduce((sum, n) => sum + n, 0) / used.length, samples: used.length };
}

// GET /api/vault/gas?chain=56
// the round trip the form prices: recent opens plus recent exits, with the
// contract's measured constants as the fallback per side
export async function GET(req: NextRequest): Promise<NextResponse> {
  const asked = Number(req.nextUrl.searchParams.get("chain"));
  const chainId = Number.isFinite(asked) && asked > 0 ? asked : targetChainId();
  const vault = vaultFor(chainId);
  if (!vault) {
    return NextResponse.json({ success: false, error: `no vault on chain ${chainId}` }, { status: 404 });
  }

  const client = createPublicClient({
    chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
    transport: http(logEndpoint(chainId), { timeout: 20_000 }),
  });

  try {
    const head = await client.getBlockNumber();
    const [opens, closes] = await Promise.all([
      collectLogs(client, vault as `0x${string}`, OPENED, head),
      collectLogs(client, vault as `0x${string}`, CLOSED, head),
    ]);
    const [open, withdraw] = await Promise.all([averageGas(client, opens), averageGas(client, closes)]);
    const estimate = estimateRoundTrip({
      openGas: open.gas,
      withdrawGas: withdraw.gas,
      openSamples: open.samples,
      withdrawSamples: withdraw.samples,
    });
    return NextResponse.json(
      {
        success: true,
        chainId,
        vault,
        blockNumber: Number(head),
        ...estimate,
        openSamples: open.samples,
        withdrawSamples: withdraw.samples,
      },
      { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (e) {
    // a node that will not serve the range is not a reason to invent a number
    return NextResponse.json(
      { success: false, error: (e as Error).message.slice(0, 160) },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
