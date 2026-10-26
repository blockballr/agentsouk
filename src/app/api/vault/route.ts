import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { vaultFor } from "@/lib/vault";
import { BSC_TESTNET_CHAIN_ID } from "@/lib/types";

export const dynamic = "force-dynamic";

const READ_ABI = parseAbi([
  "function minDepositInToken0() view returns (uint256)",
  "function MAX_OPEN_PER_BUYER() view returns (uint256)",
]);

async function readConfig(chainId: number, address: string) {
  const client = createPublicClient({
    chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
    transport: http(),
  });
  let minDeposit: string | null = null;
  let maxOpen: number | null = null;
  try {
    const min = await client.readContract({ address: address as `0x${string}`, abi: READ_ABI, functionName: "minDepositInToken0" });
    minDeposit = (min as bigint).toString();
  } catch { /* leave null */ }
  try {
    const max = await client.readContract({ address: address as `0x${string}`, abi: READ_ABI, functionName: "MAX_OPEN_PER_BUYER" });
    maxOpen = Number(max);
  } catch { /* leave null */ }
  return { minDepositInToken0: minDeposit, maxOpenPerBuyer: maxOpen };
}

// Public discovery of Agent Souk's HireVault addresses per chain, so a buyer on
// any marketplace that lists our agent can open a funded trading mandate.
export async function GET(req: NextRequest) {
  const asked = Number(req.nextUrl.searchParams.get("chain"));
  const chains = Number.isFinite(asked) && asked > 0 ? [asked] : [56, 97];
  const vaults = [];
  for (const chainId of chains) {
    const address = vaultFor(chainId);
    if (!address) continue;
    const config = await readConfig(chainId, address);
    vaults.push({ chainId, address, ...config });
  }
  return NextResponse.json({ success: true, vaults });
}
