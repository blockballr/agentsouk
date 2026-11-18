import { NextRequest, NextResponse } from "next/server";
import { encodeFunctionData, formatUnits } from "viem";
import { TOKEN_ABI, VAULT_ABI, planVaultHire } from "../../../../../packages/cli/src/marketplace/vault-hire";
import { DEFAULT_CONFIG } from "../../../../../packages/cli/src/core/config";
import { CliError } from "../../../../../packages/cli/src/core/errors";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";
import { rpcUrls } from "@/lib/rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/vault/prepare?agent=56/391002&buyer=0x..&deposit=5&token=usdt - the exact unsigned calls
// for a vault hire, for a wallet that sends raw contract calls (an Agentic Wallet in Developer Mode).
// it runs the CLI's own planner, so the checks match `agentsouk vault hire` exactly.
// it signs nothing and moves nothing; the approval is for the deposit only, never unlimited

const LIMIT = { table: "rate_vault_prepare", limit: 20, windowMs: 60_000 };
const WRAP_SELECTOR = "0xd0e30db0";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const verdict = await enforceRateLimit(LIMIT, { keys: [`ip:${clientIpFrom(req.headers)}`] }).catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
  if (!verdict.allowed) {
    return NextResponse.json({ success: false, error: `Too many requests. Try again in ${verdict.retryAfterSeconds} seconds.` }, { status: 429 });
  }
  const q = req.nextUrl.searchParams;
  const ref = (q.get("agent") ?? "").trim();
  const match = /^(?:56\/)?(\d{1,12})$/.exec(ref);
  const buyer = q.get("buyer") ?? "";
  if (!match) return NextResponse.json({ success: false, error: "agent must be a token id such as 56/391002" }, { status: 400 });
  if (!/^0x[0-9a-fA-F]{40}$/.test(buyer)) return NextResponse.json({ success: false, error: "buyer must be the wallet address that will sign" }, { status: 400 });

  const config = { ...DEFAULT_CONFIG, apiUrl: process.env.PUBLIC_API_URL ?? DEFAULT_CONFIG.apiUrl, rpcUrl: rpcUrls(56)[0] ?? DEFAULT_CONFIG.rpcUrl };
  try {
    const plan = await planVaultHire(config, buyer as `0x${string}`, 56, match[1]!, {
      deposit: q.get("deposit") ?? "",
      token: q.get("token") ?? "usdt",
      // the CLI's own flag defaults, passed as text the way its flags arrive
      days: q.get("days") ?? "1",
      slippage: q.get("slippage") ?? "5",
      fee: "auto",
      agentFee: "0",
      maxLoss: q.get("maxLoss") ?? "20",
      venue: q.get("venue") ?? "none",
    });
    const calls: { step: string; to: string; data: string; value: string; why: string }[] = [];
    if (plan.wrapWei > 0n) {
      calls.push({ step: "wrap", to: plan.token.address, data: WRAP_SELECTOR, value: plan.wrapWei.toString(), why: `wrap ${formatUnits(plan.wrapWei, 18)} BNB into WBNB for the deposit` });
    }
    if (plan.needsApprove) {
      calls.push({
        step: "approve",
        to: plan.token.address,
        data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [plan.vault, plan.amount] }),
        value: "0",
        why: `let the vault take exactly ${plan.amountText} ${plan.token.symbol}, no more`,
      });
    }
    calls.push({
      step: "open",
      to: plan.vault,
      data: encodeFunctionData({
        abi: VAULT_ABI,
        functionName: "open",
        args: [plan.agentWallet, plan.token.address, plan.amount, BigInt(plan.expiry), plan.slippageBps, plan.fee, plan.agentFeeBps, plan.maxLossBps, plan.venue],
      }),
      value: "0",
      why: `open the hire: ${plan.amountText} ${plan.token.symbol} stays in the vault, ${plan.agentName} may trade it until ${plan.expiryIso}, and the buyer can withdraw at any time`,
    });
    return NextResponse.json(
      {
        success: true,
        chainId: 56,
        agent: plan.agentName,
        tokenId: plan.tokenId,
        agentWallet: plan.agentWallet,
        buyer: plan.client,
        deposit: `${plan.amountText} ${plan.token.symbol}`,
        expiry: plan.expiryIso,
        maxLoss: `${plan.maxLossBps / 100}%`,
        agentFee: `${plan.agentFeeBps / 100}%`,
        calls,
        // the open's transaction hash goes here once it is mined, so the right strategy runs the hire
        after: { method: "POST", url: `${config.apiUrl}/api/vault/policy-tag/register`, body: { txHash: "<open tx hash>", chainId: 56, tokenId: plan.tokenId } },
        withdraw: "the buyer ends the hire and takes every balance back with withdraw(hireId) on the same vault",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CliError) return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: 400 });
    return NextResponse.json({ success: false, error: "could not prepare this hire right now" }, { status: 502 });
  }
}
