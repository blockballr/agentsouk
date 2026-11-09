// Public read of the standing watch's last runs. No secret: it exposes timing,
// gas and pass or fail, never a buyer's key. Given a wallet, it also derives
// that buyer's defence from the mandate, the plan and the watch, so an agent
// gets one state and one action list instead of four reads.

import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { deriveDefence } from "@agora/core";
import { readPipelineState, recentCronRuns } from "@/lib/history-store";
import { parseGasState, watchStatus } from "@/lib/health-status";
import { readFeeBalance, readMandate, readPlan } from "@/lib/health-operator";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const ZERO = "0x0000000000000000000000000000000000000000";

export async function GET(req: NextRequest) {
  const [runs, gasState] = await Promise.all([
    recentCronRuns("health-watch", 10),
    readPipelineState("health:gas"),
  ]);
  const status = watchStatus(runs);
  const gas = parseGasState(gasState);

  const wallet = (req.nextUrl.searchParams.get("wallet") ?? "").toLowerCase();
  const operator = process.env.HEALTH_OPERATOR_ADDRESS as Address | undefined;
  const subscription = process.env.HEALTH_SUBSCRIPTION_ADDRESS as Address | undefined;

  let defence = null;
  if (/^0x[0-9a-f]{40}$/.test(wallet) && wallet !== ZERO && operator) {
    const [mandate, plan, fee] = await Promise.all([
      readMandate(operator, wallet as Address).catch(() => null),
      subscription ? readPlan(subscription, wallet as Address).catch(() => null) : Promise.resolve(null),
      subscription ? readFeeBalance(subscription, wallet as Address).catch(() => 0n) : Promise.resolve(0n),
    ]);
    defence = deriveDefence({
      now: Math.floor(Date.now() / 1000),
      mandate: mandate
        ? { active: mandate.active, expiry: mandate.expiry, positions: mandate.positions.length }
        : null,
      plan: plan ? { agent: plan.agent, expiry: plan.expiry } : null,
      feeBalance: fee ?? 0n,
      watch: { stale: status.stale, consecutiveFailures: status.consecutiveFailures, ok: status.ok },
      gasLow: gas ? gas.low : null,
    });
  }

  return NextResponse.json(
    { ...status, gas, defence, chainId: targetChainId() },
    { headers: { "cache-control": "no-store" } },
  );
}
