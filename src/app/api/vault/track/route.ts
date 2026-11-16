import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { receiptsForAgent } from "@/lib/receipt-store";
import { VAULT_READ_ABI, vaultFor } from "@/lib/vault";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";
import { collectVaultLogs, vaultLogEndpoint } from "@/lib/vault-logs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TRADED = parseAbiItem(
  "event Traded(uint256 indexed id, address indexed agent, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// GET /api/vault/track?chain=97&agent=0x...
// what the vault itself recorded for one agent. counts, not claims. hires come
// from contract state, which answers at any age. trades have no counter in the
// contract, so they are the larger of the Traded events a log scan can still
// reach (hours, not days) and the trades our own receipts hold; for an agent
// that runs its own executor and traded before the scan window, that is a floor.
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
    const errors: string[] = [];
    const [ids, trades, receipts] = await Promise.all([
      client.readContract({ address: vault as Address, abi: VAULT_READ_ABI, functionName: "hiresFor", args: [agent as Address] }),
      collectVaultLogs(client, vault as Address, TRADED, head, { args: { agent: agent as Address }, want: 500, errors }),
      receiptsForAgent(agent, 500).catch(() => []),
    ]);
    // one batched read, so an agent with many hires is one call to the endpoint and not one per hire
    const rows = await client.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: vault as Address, abi: VAULT_READ_ABI, functionName: "hire" as const, args: [id] as const })),
    });
    const openHires = rows.filter((row) => row[4]).length;
    // receipts are kept per chain, not per vault, so only those for a hire this
    // vault lists under the agent count; an earlier deployment's do not
    const mine = new Set(ids.map((id) => id.toString()));
    const traded = receipts.filter((r) => r.chainId === chainId && r.status === "traded" && mine.has(String(r.hireId)));
    const blocks = [...trades.map((log) => Number(log.blockNumber ?? 0n)), ...traded.map((r) => r.blockNumber ?? 0)].filter(
      (n) => n > 0,
    );
    const diag = req.nextUrl.searchParams.get("diag") === "1";

    return NextResponse.json(
      {
        success: true,
        chainId,
        vault,
        agent: agent.toLowerCase(),
        blockNumber: Number(head),
        hires: ids.length,
        openHires,
        closedHires: ids.length - openHires,
        trades: Math.max(trades.length, traded.length),
        lastBlock: blocks.length ? Math.max(...blocks) : null,
        ...(diag ? { endpoint: new URL(vaultLogEndpoint(chainId)).host, errors } : {}),
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
