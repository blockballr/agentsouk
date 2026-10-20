import { NextRequest, NextResponse } from "next/server";
import { validateBlueprint } from "@/lib/builder/blueprint";
import { builtAgentAddresses } from "@/lib/builder/hosting";
import { isRevoked } from "@/lib/builder/keys";
import { hasExported } from "@/lib/builder/keys";
import { checkExamples } from "@/lib/builder/run";
import { liveReader } from "@/lib/builder/sources";
import { saveBuiltAgent, listBuiltByOwner } from "@/lib/builder/store";
import { enqueue } from "@/lib/builder/outbox";
import { pickPublicOrigin } from "@/lib/house-agent";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";
import { queryAgents } from "@/lib/scanner";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIMIT = { table: "rl_builder_save", limit: 20, windowMs: 24 * 60 * 60 * 1000 };

// GET /api/builder/agents?owner=0x...   lists the built agents for a wallet
export async function GET(req: NextRequest): Promise<NextResponse> {
  const owner = req.nextUrl.searchParams.get("owner") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return json({ success: false, error: "owner must be a wallet address" }, 400);
  try {
    const built = await listBuiltByOwner(owner);
    const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
    const items = await Promise.all(
      built.map(async (b) => {
        const revoked = await isRevoked(b.id);
        const exported = await hasExported(b.id);
        return {
          id: b.id,
          name: b.blueprint.name,
          category: b.blueprint.category,
          hireMode: b.blueprint.hireMode ?? "direct",
          agentWallet: b.sellerKeyAddress,
          card: builtAgentAddresses(origin, b.id).card,
          endpoint: builtAgentAddresses(origin, b.id).endpoint,
          custody: revoked ? "revoked" : exported ? "exported" : b.sellerKeyAddress ? "held" : "none",
        };
      }),
    );
    return json({ success: true, items });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "list failed" }, 503);
  }
}
const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/agents  { owner, blueprint }
// hosts a built agent, so its card and endpoint exist before the owner registers it
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; blueprint?: unknown } | null;
  if (typeof body?.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, error: "owner must be a wallet address" }, 400);
  }
  const owner = body.owner.toLowerCase();

  try {
    const verdict = await enforceRateLimit(LIMIT, { keys: [`ip:${clientIpFrom(req.headers)}`] });
    if (!verdict.allowed) return json({ success: false, error: "Too many agents saved today. Come back tomorrow." }, 429);
  } catch {
    return json({ success: false, error: "The builder cannot be reached just now. Try again in a minute." }, 503);
  }

  // whatever the page sends is checked and proved again here, as if it had never been checked
  const check = validateBlueprint(body.blueprint);
  if (!check.ok) return json({ success: false, error: "That agent does not pass our checks. Build it again." }, 422);
  const proof = await checkExamples(check.blueprint, { read: liveReader(targetChainId()) });
  if (proof.errors.length > 0) return json({ success: false, error: "That agent's own example gives no answer. Build it again." }, 422);
  if (proof.unavailable.length > 0) return json({ success: false, error: "Live data could not be read to prove the agent. Try again in a minute." }, 503);

  try {
    // one built agent per wallet during the quest: a wallet that already listed one keeps that one
    const catalogue = await queryAgents({ limit: 5000, includeDelisted: true, includeHouse: true });
    const listed = catalogue.items.some((a) => a.owner_address?.toLowerCase() === owner && (a.a2a_endpoint ?? "").includes("/api/built/"));
    if (listed) {
      void enqueue("tollgate", owner, { reason: "free_slot_taken" });
      return json({ success: false, error: "This wallet has already listed an agent built here. One per wallet for now.", upsell: true, checkout: "/billing/yearly" }, 409);
    }

    const built = await saveBuiltAgent(owner, check.blueprint);
    const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
    void enqueue("deploy_live", owner, { id: built.id, name: built.blueprint.name });
    return json({
      success: true,
      id: built.id,
      name: built.blueprint.name,
      category: built.blueprint.category,
      description: built.blueprint.description,
      ...builtAgentAddresses(origin, built.id),
    });
  } catch (e) {
    console.error("[builder] not saved", e instanceof Error ? e.message : String(e));
    return json({ success: false, error: "The agent could not be saved just now. Try again in a minute." }, 503);
  }
}
