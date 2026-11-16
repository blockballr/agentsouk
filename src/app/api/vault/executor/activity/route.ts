import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { chunksForWindow, summarizeExecutorActivity, type ChainTrade } from "@/lib/executor-activity";
import { recentReceipts } from "@/lib/receipt-store";
import { BSC_TESTNET_CHAIN_ID, targetChainId } from "@/lib/types";
import { VAULT_READ_ABI, vaultFor } from "@/lib/vault";
import { executorWallet, executorWallets } from "@/lib/vault-executor";
import { collectVaultLogs, LOG_CHUNK, vaultLogEndpoint } from "@/lib/vault-logs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TRADED = parseAbiItem(
  "event Traded(uint256 indexed id, address indexed agent, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
);

// a log scan is one call per chunk, so the window is bounded by what fits in the route's time
const MAX_CHUNKS = 40;
const MAX_HOURS = 24;

// GET /api/vault/executor/activity?hours=12
// whether the executors have work and are doing it. hires come from contract
// state and the last pass and trade from the receipts, at any age. the Traded
// events only cover the last few hours and coveredHours says how many
export async function GET(req: NextRequest): Promise<NextResponse> {
  const asked = Number(req.nextUrl.searchParams.get("hours"));
  const hours = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_HOURS) : 12;
  const chainId = targetChainId();
  const vault = vaultFor(chainId);
  if (!vault) return NextResponse.json({ success: false, error: `no vault on chain ${chainId}` }, { status: 404 });

  const client = createPublicClient({
    chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
    transport: http(vaultLogEndpoint(chainId), { timeout: 20_000 }),
  });

  try {
    const [executor, executors, head] = await Promise.all([executorWallet(), executorWallets(), client.getBlockNumber()]);
    // the chain's own pace decides how many blocks an hour is
    const [headBlock, earlier] = await Promise.all([
      client.getBlock({ blockNumber: head }),
      client.getBlock({ blockNumber: head > LOG_CHUNK ? head - LOG_CHUNK : 0n }),
    ]);
    const secondsPerBlock = Number(headBlock.timestamp - earlier.timestamp) / Number(LOG_CHUNK);
    const chunks = chunksForWindow(hours, secondsPerBlock, Number(LOG_CHUNK), MAX_CHUNKS);

    const errors: string[] = [];
    const logs = await collectVaultLogs(client, vault as Address, TRADED, head, { want: 5_000, maxChunks: chunks, errors });
    const trades: ChainTrade[] = logs.map((log) => ({
      agent: String(log.args.agent),
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber ?? 0n),
    }));

    // what the scan really reached, which is less than asked when the window was capped or a range was refused
    const scannedBlocks = Number(LOG_CHUNK) * chunks;
    const coveredHours = errors.length === 0 ? Math.min(hours, (scannedBlocks * secondsPerBlock) / 3600) : null;
    const since = Date.now() - (coveredHours ?? hours) * 3_600_000;

    const receipts = await recentReceipts(chainId, 1_000).catch(() => []);
    const summary = summarizeExecutorActivity({ executors, trades, receipts, since });

    // state reads work at any age, unlike logs: which hires name each executor, and which are open
    const hires = new Map<string, { total: number; open: number }>();
    await Promise.all(
      executors.map(async (address) => {
        try {
          const ids = await client.readContract({
            address: vault as Address,
            abi: VAULT_READ_ABI,
            functionName: "hiresFor",
            args: [address as Address],
          });
          const rows = await client.multicall({
            allowFailure: false,
            contracts: ids.map((id) => ({ address: vault as Address, abi: VAULT_READ_ABI, functionName: "hire" as const, args: [id] as const })),
          });
          hires.set(address.toLowerCase(), { total: ids.length, open: rows.filter((row) => row[4]).length });
        } catch {
          // left unset, so the row reports null rather than a zero it did not read
        }
      }),
    );

    // one block read per executor that traded, to say when
    const blockTimes = new Map<number, string>();
    await Promise.all(
      [...new Set(summary.flatMap((row) => (row.lastChainTrade ? [row.lastChainTrade.blockNumber] : [])))].map(async (n) => {
        const block = await client.getBlock({ blockNumber: BigInt(n) }).catch(() => null);
        if (block) blockTimes.set(n, new Date(Number(block.timestamp) * 1000).toISOString());
      }),
    );

    return NextResponse.json(
      {
        success: true,
        chainId,
        vault,
        kind: executor?.kind ?? null,
        askedHours: hours,
        // null when a log range was refused, so the counts below are a floor and not a total
        coveredHours: coveredHours === null ? null : Math.round(coveredHours * 10) / 10,
        blockNumber: Number(head),
        tradesInWindow: trades.length,
        openHires: [...hires.values()].reduce((sum, row) => sum + row.open, 0),
        executors: summarizeExecutorActivity({ executors, trades, receipts, since, blockTimes, hires }),
        ...(req.nextUrl.searchParams.get("diag") === "1" ? { endpoint: new URL(vaultLogEndpoint(chainId)).host, errors } : {}),
      },
      { headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=300" } },
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message.slice(0, 160) }, { status: 502 });
  }
}
