import { NextRequest, NextResponse } from "next/server";
import { queryAgents } from "@/lib/scanner";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

function sameAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner")?.trim() ?? "";
  if (!owner) {
    return NextResponse.json(
      { success: false, error: "owner required" },
      { status: 400 },
    );
  }
  const chainId = targetChainId();
  const catalogue = await queryAgents({ limit: 5000 });
  const agents = catalogue.items
    .filter((a) => sameAddr(a.owner_address, owner))
    .map((a) => ({
      chainId: a.chain_id,
      tokenId: a.token_id,
      agentId: a.agent_id,
      name: a.name,
      category: a.category ?? "general",
      contractAddress: a.contract_address,
      ownerAddress: a.owner_address,
    }));
  const categories: Record<string, number> = {};
  for (const a of agents) {
    const key = String(a.category);
    categories[key] = (categories[key] ?? 0) + 1;
  }
  return NextResponse.json({
    success: true,
    owner,
    chainId,
    agents,
    counts: {
      agents: agents.length,
      categories,
    },
  });
}
