import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { bsc } from "viem/chains";
import { rpcTransport } from "@/lib/rpc";
import { readVenusPosition, VENUS_MAINNET } from "@/lib/venus";
import { decideLendingDefense, lendingDefensePolicyFromEnv } from "@/lib/lending-defense-policy";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const account = (req.nextUrl.searchParams.get("account") ?? process.env.LENDING_ACCOUNT ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) {
    return NextResponse.json(
      { success: false, error: "pass ?account=0x... or set LENDING_ACCOUNT" },
      { status: 400 },
    );
  }

  const chainId = VENUS_MAINNET.chainId;
  const client = createPublicClient({
    chain: bsc,
    transport: rpcTransport(chainId),
  });

  const policy = lendingDefensePolicyFromEnv(process.env);
  const holdings = {
    stableUsd: Number(process.env.LENDING_STABLE_USD ?? "0"),
    collateralUsd: Number(process.env.LENDING_COLLATERAL_USD ?? "0"),
  };

  try {
    const position = await readVenusPosition(client, account);
    const decision = decideLendingDefense(position, policy, holdings);
    return NextResponse.json({
      success: true,
      dryRun: true,
      chainId,
      account,
      profile: policy.profile,
      triggerHealthFactor: policy.triggerHealthFactor,
      position: {
        healthFactor: position.healthFactor,
        collateralUsd: position.totalCollateralUsd,
        borrowUsd: position.totalBorrowUsd,
        liquidatable: position.liquidatable,
      },
      decision: {
        action: decision.action,
        amountUsd:
          "amountUsd" in decision
            ? decision.amountUsd
            : "amountToSell" in decision
              ? Number(decision.amountToSell) / 1e18
              : 0,
        reason: decision.reason,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
