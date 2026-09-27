import { NextResponse } from "next/server";
import { settlementAsset, targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// The chain this deployment serves and the asset hires settle in, so a page can
// state the network without fetching the whole catalogue.
export async function GET() {
  const chainId = targetChainId();
  let settlementSymbol: string | null = null;
  try {
    settlementSymbol = settlementAsset(chainId).symbol;
  } catch {
    // a chain without a configured asset still reports its id
  }
  return NextResponse.json({ success: true, chainId, settlementSymbol });
}
