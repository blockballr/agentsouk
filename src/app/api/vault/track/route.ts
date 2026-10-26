import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { vaultFor } from "@/lib/vault";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";
import { collectVaultLogs, vaultLogEndpoint } from "@/lib/vault-logs";

export const dynamic = "force-dynamic";

const OPENED = parseAbiItem(
  "event Opened(uint256 indexed id, address indexed buyer, address indexed agent, address token, uint256 amount, uint64 expiry, uint16 maxSlippageBps, uint16 agentFeeBps, uint16 maxLossBps)",
);
const TRADED = parseAbiItem(
  "event Traded(uint256 indexed id, address indexed agent, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
);
const CLOSED = parseAbiItem(
  "event Closed(uint256 indexed id, address indexed buyer, address indexed agent, uint256 amountA, uint256 amountB, uint256 deployedB, uint256 agentFee)",
);

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// GET /api/vault/track?chain=97&agent=0x...
// what the vault itself recorded for one agent. counts, not claims: hires opened,
// still open, closed, and trades sent. the receipts hold the details.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const asked = Number(req.nextUrl.searchParams.get("chain"));
  const chainId = Number.isFinite(asked) && asked > 0 ? asked : targetChainId();
  const agent = req.nextUrl.searchParams.get("agent") ?? "";
  if (!ADDRESS.test(agent)) {
    return NextResponse.json({ success: false, error: "a valid agent address is required" }, { status: 400 });
  }
  const vault = vaultFor(chainId);
  if (!vault) {
    return NextResponse.json({ success: false, error: `no vault on chain ${chainId}` }, { status: 404 });
  }

  const client = createPublicClient({
    chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
    transport: http(vaultLogEndpoint(chainId), { timeout: 20_000 }),
  });

  try {
    const head = await client.getBlockNumber();
    const args = { agent: agent as Address };
    const [opens, trades, closes] = await Promise.all([
      collectVaultLogs(client, vault as Address, OPENED, head, { args, want: 500 }),
      collectVaultLogs(client, vault as Address, TRADED, head, { args, want: 500 }),
      collectVaultLogs(client, vault as Address, CLOSED, head, { args, want: 500 }),
    ]);
    const closedIds = new Set(closes.map((log) => String(log.args.id)));
    const openHires = opens.filter((log) => !closedIds.has(String(log.args.id))).length;
    const blocks = [...opens, ...trades, ...closes].map((log) => Number(log.blockNumber ?? 0n));

    return NextResponse.json(
      {
        success: true,
        chainId,
        vault,
        agent: agent.toLowerCase(),
        blockNumber: Number(head),
        hires: opens.length,
        openHires,
        closedHires: closes.length,
        trades: trades.length,
        lastBlock: blocks.length ? Math.max(...blocks) : null,
      },
      { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message.slice(0, 160) },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
