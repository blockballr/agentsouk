import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { agentRegistryRef } from "@/lib/registry-write";
import { pickPublicOrigin } from "@/lib/reference-yield";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

interface Row {
  chainId: number;
  tokenId?: string;
  slug?: string;
  card?: string;
  name?: string;
  description?: string;
  wallet?: string;
  policy?: string;
  vaultOnly?: boolean;
  category?: string;
  skills?: { id?: string; name?: string; description?: string }[];
}

function find(chainId: number, slug: string): Row | null {
  const file = path.join(process.cwd(), "data", "first-party-agents.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as { agents?: Row[] };
  return (raw.agents ?? []).find((a) => Number(a.chainId) === chainId && a.slug === slug) ?? null;
}

// GET /api/agents/first-party/[chainId]/[slug]
// the permanent registration document for a first-party vault agent. the URL is
// set as the agentURI at registration and never changes, so the body may gain the
// token id later without the on-chain pointer moving.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; slug: string }> },
): Promise<NextResponse> {
  const { chainId, slug } = await params;
  const id = Number(chainId);
  if (!Number.isFinite(id) || !slug) {
    return NextResponse.json({ error: "a chain and a slug are required" }, { status: 400 });
  }

  let row: Row | null = null;
  try {
    row = find(id, slug);
  } catch {
    return NextResponse.json({ error: "the registry file is unreadable" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "no first-party agent at this slug" }, { status: 404 });
  }

  const card = String(row.card ?? "").trim();
  if (!card) {
    return NextResponse.json({ error: "the agent has no A2A card" }, { status: 500 });
  }

  const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
  const tokenId = String(row.tokenId ?? "").trim();
  const endpoint = `${origin}/api/reference/${card}/.well-known/agent-card.json`;

  const file = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: row.name,
    description: row.description,
    image: "https://agentsouk.xyz/Edgy.png",
    ...(row.wallet ? { agentWallet: row.wallet } : {}),
    ...(row.category ? { category: row.category } : {}),
    ...(row.skills?.length
      ? {
          skills: row.skills.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
          })),
        }
      : {}),
    services: [{ name: "A2A", endpoint }],
    x402Support: row.vaultOnly === true ? false : true,
    active: true,
    registrations: tokenId
      ? [{ agentId: tokenId, agentRegistry: agentRegistryRef(id) }]
      : [],
  };

  return NextResponse.json(file, { headers: JSON_HEADERS });
}
