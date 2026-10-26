import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { getCustomAgent } from "@/lib/builder/custom";
import { isAllowlisted } from "@/lib/builder/venue-adapter";
import { vaultFor, VAULT_ABI, VAULT_READ_ABI } from "@/lib/vault";
import { resolveActor } from "@/lib/vault-actor";
import { targetChainId, BSC_TESTNET_CHAIN_ID, BSC_CHAIN_ID } from "@/lib/types";
import { rpcTransport } from "@/lib/rpc";
import { bsc, bscTestnet } from "viem/chains";
import { encodeFunctionData } from "viem";
import { verifyWalletAuth } from "@/lib/builder/auth";
import { saveHirerReceipt, listHirerReceipts } from "@/lib/builder/hirer-receipts";
import { emitNotification } from "@/lib/notifications";

const STABLECOINS = new Set([
  "0x55d398326f99059ff775485246999027b3197955", // USDT mainnet
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC mainnet
  "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD mainnet
  "0x1af3f329e8be154074e62361356e60e824f000c", // DAI mainnet (approx)
  "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd", // USDT testnet
]);

function isStablecoin(addr: string): boolean {
  return STABLECOINS.has(addr.toLowerCase());
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

function chainFor(chainId: number) {
  return chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc;
}

// POST /api/builder/custom/hirer-execute
// { owner (hirer), agentId, hireId, action: { name, venue, contracts, functions, maxValueUsd },
//   params: { tokenIn, amountIn, minOut } }
// Headers: x-wallet-signature, x-wallet-timestamp (wallet auth)
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as {
    owner?: unknown;
    agentId?: unknown;
    hireId?: unknown;
    action?: unknown;
    params?: unknown;
  } | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address (hirer)" }, 400);
  }
  if (typeof body.agentId !== "string" || !body.agentId.trim()) {
    return json({ success: false, ok: false, error: "agentId is required" }, 400);
  }
  if (typeof body.hireId !== "string" && typeof body.hireId !== "number") {
    return json({ success: false, ok: false, error: "hireId is required" }, 400);
  }

  const auth = await verifyWalletAuth(req, body.owner, "hirer-execute", body.agentId);
  if (!auth.ok) {
    return json({ success: false, ok: false, error: auth.error }, 401);
  }

  const chainId = targetChainId();
  const vault = vaultFor(chainId);
  if (!vault) {
    return json({ success: false, ok: false, error: "no vault configured for this chain" }, 503);
  }

  const agent = await getCustomAgent(body.agentId);
  if (!agent) {
    return json({ success: false, ok: false, error: "agent not found" }, 404);
  }

  const action = body.action as { name?: string; venue?: string; contracts?: string[]; functions?: string[]; maxValueUsd?: number } | null;
  if (!action || !action.name || !action.venue) {
    return json({ success: false, ok: false, error: "action is required with name and venue" }, 400);
  }
  const manifestAction = agent.manifest.actions.find((a) => a.name === action.name && a.venue === action.venue);
  if (!manifestAction) {
    return json({ success: false, ok: false, error: "action not declared in agent manifest" }, 403);
  }

  // the caller may not raise the cap above the manifest's declared value
  if (typeof action.maxValueUsd === "number" && action.maxValueUsd !== manifestAction.maxValueUsd) {
    return json({ success: false, ok: false, error: "maxValueUsd must match the manifest declaration" }, 403);
  }

  const venueAction = {
    name: action.name,
    venue: action.venue,
    contracts: action.contracts ?? manifestAction.contracts,
    functions: action.functions ?? manifestAction.functions,
    maxValueUsd: manifestAction.maxValueUsd,
  };
  if (!isAllowlisted(venueAction)) {
    return json({ success: false, ok: false, error: "action not allowlisted for hirer-funded execution" }, 403);
  }

  // only the vault swap is supported today
  if (venueAction.name !== "swap" || venueAction.venue !== "pancakeswap-v3") {
    return json({ success: false, ok: false, error: "only the vault swap action is supported" }, 400);
  }

  const params = body.params as { tokenIn?: string; amountIn?: string; minOut?: string } | null;
  const hireId = BigInt(body.hireId as string | number);
  const tokenIn = params?.tokenIn ?? "0x0000000000000000000000000000000000000000";
  const amountIn = params?.amountIn ? BigInt(params.amountIn) : 0n;
  const minOut = params?.minOut ? BigInt(params.minOut) : 0n;

  // read the hire and verify it is open, not expired, and names this executor as agent
  const actor = await resolveActor(process.env.AGENT_EXECUTOR_ACTOR ?? "rawkey", chainId);
  const executorAddress = (await actor.address()).toLowerCase();

  const publicClient = createPublicClient({ chain: chainFor(chainId), transport: rpcTransport(chainId) });
  let hire: {
    buyer: string; agent: string; expiry: number; open: boolean;
    balanceA: bigint; balanceB: bigint; refPriceX96: bigint;
  };
  let tokenA = "";
  let tokenB = "";
  try {
    const raw = await publicClient.readContract({
      address: vault as `0x${string}`,
      abi: VAULT_READ_ABI,
      functionName: "hire",
      args: [hireId],
    }) as readonly [string, string, bigint, number, boolean, bigint, bigint, bigint, number, bigint];
    hire = { buyer: raw[0], agent: raw[1], expiry: Number(raw[2]), open: raw[4], balanceA: raw[5], balanceB: raw[6], refPriceX96: raw[7] };
    tokenA = (await publicClient.readContract({ address: vault as `0x${string}`, abi: VAULT_READ_ABI, functionName: "tokenA" })) as string;
    tokenB = (await publicClient.readContract({ address: vault as `0x${string}`, abi: VAULT_READ_ABI, functionName: "tokenB" })) as string;
  } catch (e) {
    return json({ success: false, ok: false, error: "hire not found or unreadable" }, 404);
  }
  if (!hire.open) {
    return json({ success: false, ok: false, error: "hire is not open" }, 403);
  }
  if (hire.expiry <= Math.floor(Date.now() / 1000)) {
    return json({ success: false, ok: false, error: "hire has expired" }, 403);
  }
  if (hire.agent.toLowerCase() !== executorAddress) {
    return json({
      success: false, ok: false,
      error: `hire agent (${hire.agent}) does not match executor (${executorAddress}); cannot trade`,
    }, 403);
  }
  // amount must fit the hire balance (contract also enforces this, but fail early with a clear reason).\r\n  // tokenIn -> A/B mapping requires the hire token addresses, which we do not have here,\r\n  // so we rely on the contract check.\r\n
  if (amountIn <= 0n) {
    return json({ success: false, ok: false, error: "amountIn must be greater than zero" }, 400);
  }

  // best-effort USD cap enforcement. The manifest cap is declared in USD; convert
  // amountIn to USD using the hire's reference price when a stablecoin is involved.
  // If no conversion is possible, skip (the contract drawdown budget remains the
  // hard bound) rather than reject, so a missing price feed cannot block a trade.
  try {
    const capUsd = manifestAction.maxValueUsd;
    if (capUsd > 0) {
      const tokenInLower = tokenIn.toLowerCase();
      const tokenALower = tokenA.toLowerCase();
      const tokenBLower = tokenB.toLowerCase();
      const aIn = tokenInLower === tokenALower;
      const otherToken = aIn ? tokenBLower : tokenALower;
      let usdValue: number | null = null;
      if (isStablecoin(tokenInLower)) {
        usdValue = Number(amountIn) / 1e18;
      } else if (isStablecoin(otherToken)) {
        // refPriceX96 is tokenB per tokenA in Q96 fixed point
        const ref = Number(hire.refPriceX96) / 2 ** 96;
        const price = aIn ? ref : (ref > 0 ? 1 / ref : 0);
        usdValue = (Number(amountIn) / 1e18) * price;
      }
      if (usdValue !== null && Number.isFinite(usdValue) && usdValue > capUsd) {
        return json({
          success: false, ok: false,
          error: `amountIn (~${usdValue.toFixed(2)} USD) exceeds the manifest cap of ${capUsd} USD`,
        }, 403);
      }
    }
  } catch {
    // conversion failed; rely on the contract's drawdown budget
  }

  try {
    const calldata = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "trade",
      args: [hireId, tokenIn as `0x${string}`, amountIn, minOut],
    });
    const call = { to: vault, data: calldata, value: 0n };
    const txHash = await actor.trade(call as Parameters<typeof actor.trade>[0]);

    const receiptId = `hirer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const receipt = {
      id: receiptId,
      hireId: hireId.toString(),
      agentId: body.agentId as string,
      hirer: body.owner as string,
      action: venueAction.name,
      venue: venueAction.venue,
      txHash,
      amount: amountIn.toString(),
      chainId,
      status: "executed" as const,
      createdAt: new Date().toISOString(),
    };
    await saveHirerReceipt(receipt);

    void emitNotification({
      wallet: body.owner as string,
      kind: "job_completed",
      eventKey: receiptId,
      title: "Hirer-funded action executed",
      body: `Agent ${agent.manifest.name} executed ${venueAction.name} on ${venueAction.venue}. Tx: ${txHash}`,
      href: `/agents`,
      txHash,
    }).catch(() => {});

    return json({
      success: true,
      ok: true,
      txHash,
      receiptId,
      hireId: hireId.toString(),
      action: venueAction.name,
      venue: venueAction.venue,
      note: "Executed through vault. The vault enforced the hire bounds.",
    }, 200);
  } catch (e) {
    const receiptId = `hirer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await saveHirerReceipt({
      id: receiptId,
      hireId: hireId.toString(),
      agentId: body.agentId as string,
      hirer: body.owner as string,
      action: venueAction.name,
      venue: venueAction.venue,
      txHash: "",
      amount: amountIn.toString(),
      chainId,
      status: "failed",
      createdAt: new Date().toISOString(),
    });

    return json({ success: false, ok: false, error: e instanceof Error ? e.message : "execution failed" }, 502);
  }
}

// GET /api/builder/custom/hirer-execute?hireId=...&agentId=...&owner=...
// Returns receipts scoped to the caller. owner is required.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const hireId = req.nextUrl.searchParams.get("hireId") ?? undefined;
  const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
  const owner = req.nextUrl.searchParams.get("owner");

  if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return json({ success: false, ok: false, error: "owner query param is required" }, 400);
  }

  const auth = await verifyWalletAuth(req, owner, "hirer-receipts", agentId ?? hireId ?? "");
  if (!auth.ok) {
    return json({ success: false, ok: false, error: auth.error }, 401);
  }

  const receipts = await listHirerReceipts({ hireId, agentId, hirer: owner });
  return json({ success: true, ok: true, receipts }, 200);
}
