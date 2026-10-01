import { NextRequest, NextResponse } from "next/server";
import { loadDelistedRows } from "@/lib/delist-store";
import { queryAgents } from "@/lib/scanner";
import { targetChainId } from "@/lib/types";
import { loadVerifications } from "@/lib/verifications";
import { loadStaleTokens } from "@/lib/verifications-store";

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
  const catalogue = await queryAgents({ limit: 5000, includeDelisted: true });
  const delisted = await loadDelistedRows();
  // the verifier's badge is keyed by token id, overlaid the same way the browse
  // route does; without it a lister cannot see whether the endpoint answered or
  // when it was last checked
  const verifications = await loadVerifications();
  // since when each token has been failing, so the owner's page can show the
  // maintenance countdown before the seven day delist
  const staleByToken = new Map(
    (await loadStaleTokens(0)).map((t) => [t.tokenId, t.failingSince]),
  );
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
      description: a.description ?? null,
      isVerified: a.is_verified,
      isActive: a.is_active,
      x402Supported: a.x402_supported,
      healthScore: a.health_score,
      createdAt: a.created_at,
      verification: verifications.get(a.token_id) ?? null,
      failingSince: staleByToken.get(a.token_id) ?? null,
      delisted: delisted.has(a.token_id)
        ? {
            reason: delisted.get(a.token_id)?.reason ?? null,
            at: delisted.get(a.token_id)?.delistedAt ?? null,
          }
        : null,
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
