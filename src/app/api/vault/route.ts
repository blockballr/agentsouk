import { NextResponse } from "next/server";
import { vaultFor } from "@/lib/vault";

export const dynamic = "force-dynamic";

// Public discovery of Agent Souk's HireVault addresses per chain, so a buyer on
// any marketplace that lists our agent can open a funded trading mandate.
export async function GET() {
  const chains = [56, 97];
  const vaults = chains
    .map((chainId) => ({ chainId, address: vaultFor(chainId) }))
    .filter((v) => v.address !== null);
  return NextResponse.json({ success: true, vaults });
}
