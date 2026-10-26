import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, parseAbiItem } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "@/lib/rpc";
import { vaultFor } from "@/lib/vault";
import { PANCAKE_V3_FACTORY, pancakeToken } from "@/lib/pancake";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";

export const dynamic = "force-dynamic";

const HIRES_ABI = [
  { name: "hiresOf", type: "function", stateMutability: "view", inputs: [{ name: "buyer", type: "address" }], outputs: [{ type: "uint256[]" }] },
  { name: "hire", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [
    { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "uint16" }, { type: "bool" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint160" }, { type: "uint24" }, { type: "uint256" },
  ] },
] as const;

const POOL_ABI = [
  { name: "token0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "observe", type: "function", stateMutability: "view", inputs: [{ name: "secondsAgos", type: "uint32[]" }], outputs: [
    { name: "tickCumulatives", type: "int56[]" }, { name: "secondsPerLiquidity", type: "uint160[]" },
  ] },
] as const;

const FACTORY_ABI = [
  { name: "getPool", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }, { name: "b", type: "address" }, { name: "fee", type: "uint24" }], outputs: [{ type: "address" }] },
] as const;

const CLOSED_EVENT = parseAbiItem(
  "event Closed(uint256 indexed id, address indexed buyer, address indexed agent, uint256 amountA, uint256 amountB, uint256 deployedB, uint256 agentFee)",
);
const TWAP_WINDOW = 1800;

function priceFromTwap(tickCumulatives: readonly bigint[], baseIsToken0: boolean): number {
  const delta = Number(tickCumulatives[1] - tickCumulatives[0]);
  if (delta === 0) return 0;
  const ratio = Math.pow(1.0001, delta / TWAP_WINDOW);
  return baseIsToken0 ? ratio : 1 / ratio;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const buyer = req.nextUrl.searchParams.get("buyer") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(buyer)) {
    return NextResponse.json({ success: false, error: "buyer required" }, { status: 400 });
  }
  const chainId = Number(req.nextUrl.searchParams.get("chainId")) || targetChainId();
  const vault = vaultFor(chainId);
  if (!vault) return NextResponse.json({ success: false, error: `no vault on chain ${chainId}` }, { status: 400 });

  const client = createPublicClient({
    chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
    transport: rpcTransport(chainId),
  });

  const unread: Record<string, string> = {};
  let blockNumber: number | null = null;
  let blockTime: string | null = null;
  try {
    const block = await client.getBlock({ blockTag: "latest" });
    blockNumber = Number(block.number);
    blockTime = new Date(Number(block.timestamp) * 1000).toISOString();
  } catch (e) {
    unread.blockNumber = e instanceof Error ? e.message.slice(0, 120) : "rpc did not answer";
  }

  const ids = await client.readContract({
    address: vault as `0x${string}`,
    abi: HIRES_ABI,
    functionName: "hiresOf",
    args: [buyer as `0x${string}`],
  }) as bigint[];

  const base = pancakeToken(chainId, "WBNB");
  const quote = pancakeToken(chainId, "USDT");
  const priceByFee = new Map<number, number>();
  const closeFrom = blockNumber != null
    ? BigInt(Math.max(0, blockNumber - Number(process.env.VAULT_CLOSE_WINDOW_BLOCKS ?? 20_000)))
    : 0n;

  const positions = [];
  for (const id of ids) {
    const hire = await client.readContract({
      address: vault as `0x${string}`,
      abi: HIRES_ABI,
      functionName: "hire",
      args: [id],
    }) as readonly unknown[];

    const open = Boolean(hire[4]);
    const fee = Number(hire[8]);
    const deposit = Number(hire[9]) / 1e18;
    let price = priceByFee.get(fee) ?? null;

    if (price == null && base && quote) {
      try {
        const pool = await client.readContract({
          address: PANCAKE_V3_FACTORY,
          abi: FACTORY_ABI,
          functionName: "getPool",
          args: [base.address as `0x${string}`, quote.address as `0x${string}`, fee],
        }) as string;
        if (pool && !/^0x0{40}$/i.test(pool)) {
          const [token0, observed] = await Promise.all([
            client.readContract({ address: pool as `0x${string}`, abi: POOL_ABI, functionName: "token0" }),
            client.readContract({ address: pool as `0x${string}`, abi: POOL_ABI, functionName: "observe", args: [[TWAP_WINDOW, 0]] }),
          ]);
          const ticks = observed[0];
          if (ticks.length < 2) throw new Error("no twap ticks");
          price = priceFromTwap(ticks, String(token0).toLowerCase() === base.address.toLowerCase());
          if (price === 0) throw new Error("no twap movement");
          priceByFee.set(fee, price);
        }
      } catch {
        unread[`price_${fee}`] = "30 minute twap did not answer";
      }
    }

    let value: number | null = null;
    let pnl: number | null = null;
    let realized: number | null = null;
    let kind: "unrealized" | "realized" | "none" = "none";

    if (open && price != null) {
      value = Number(hire[5]) / 1e18 * price + Number(hire[6]) / 1e18;
      pnl = value - deposit;
      kind = "unrealized";
    } else if (!open) {
      try {
        const logs = await client.getLogs({
          address: vault as `0x${string}`,
          event: CLOSED_EVENT,
          args: { id },
          fromBlock: closeFrom,
          toBlock: blockNumber != null ? BigInt(blockNumber) : "latest",
        });
        const log = logs[0];
        if (log && price != null) {
          const { amountA, amountB, deployedB } = log.args;
          if (amountA != null && amountB != null && deployedB != null) {
            realized = Number(amountA) / 1e18 * price + Number(amountB) / 1e18 + Number(deployedB) / 1e18 - deposit;
            kind = "realized";
          } else {
            unread[`realized_${id}`] = "close event missing amounts";
          }
        } else {
          unread[`realized_${id}`] = "close event outside the search window";
        }
      } catch {
        unread[`realized_${id}`] = "close event lookup failed";
      }
    }

    positions.push({
      id: id.toString(),
      agent: String(hire[1]),
      open,
      fee,
      deposit,
      value,
      pnl,
      realized,
      pnlKind: kind,
      expiry: Number(hire[2]),
    });
  }

  return NextResponse.json({
    success: true,
    ok: true,
    chainId,
    blockNumber,
    blockTime,
    priceSource: "twap",
    priceWindowSec: TWAP_WINDOW,
    ...(Object.keys(unread).length ? { unread } : {}),
    buyer,
    positions,
  }, { headers: { "cache-control": "no-store" } });
}
