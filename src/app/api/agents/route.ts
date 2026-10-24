import { NextRequest, NextResponse } from "next/server";
import { queryAgents } from "@/lib/scanner";
import { targetChainId } from "@/lib/types";
import { loadVerifications } from "@/lib/verifications";
import { isPancakeSwapAgent, readsPancakeSwap } from "@/lib/pancakeswap";
import { findActiveSession } from "@/lib/x402";
import { revokedAmong } from "@/lib/receipts-store";
import { hydrateBoostsFromDb, isBoosted } from "@/lib/boosts";
import { withListingEdit } from "@/lib/listing-edit";
import { listCustomAgents } from "@/lib/builder/custom";
import { editKey, loadListingEdits } from "@/lib/listing-edit-store";
import { firstPartyCategory, firstPartyDescription, firstPartySkills, firstPartyVaultOnly, firstPartyWallet } from "@/lib/first-party-copy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") ?? "all";
  const q = sp.get("q") ?? "";
  // no sort named reads as score: the chain's first metric, with reachability
  // settling the ties underneath it and job tiering leading everything
  const type = sp.get("type") as "all" | "jobs" | "x402" | "vault" | null;
  const metric = sp.get("metric") as "score" | "newest" | "feedback" | "health" | null;
  const sort = sp.get("sort") as string | null;
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const limit = Math.min(60, Math.max(1, Number(sp.get("limit") ?? 24) || 24));
  const warm = sp.get("warm") === "1";
  const maxWarmPages = Math.min(12, Math.max(1, Number(sp.get("warmPages") ?? 6) || 6));
  const pcs = sp.get("pcs") === "1";

  const verifications = await loadVerifications();
  const customAgents = await listCustomAgents().catch(() => []);
  const customByToken = new Map<string, (typeof customAgents)[number]>();
  for (const ca of customAgents) {
    if (ca.onChainTokenId) customByToken.set(String(ca.onChainTokenId), ca);
  }

  const result = await queryAgents({
    category,
    q,
    type: type ?? undefined,
    metric: metric ?? undefined,
    sort: (sort as "jobs" | "x402" | "score" | "newest" | "feedback" | "health" | "reachability" | undefined) ?? undefined,
    page,
    limit,
    ensureWarm: warm,
    maxWarmPages,
    pcs,
    verifications,
    seed: sp.get("seed"),
    includeHouse: sp.get("house") === "all",
  });

  // capture skills for entries that never had them, so the shelf carries the
  // job protocol (and the executes-jobs tag) without waiting for a refresh.
  // bounded and best-effort: a slow card must not hold the whole page
  try {
    const { captureAgentSkills } = await import("@/lib/agent-interface");
    const { saveShelfAgents } = await import("@/lib/shelf-store");
    const missing = result.items.filter((a) => !a.skills || a.accessGated === undefined).slice(0, 6);
    if (missing.length > 0) {
      await Promise.all(
        missing.map(async (a) => {
          try {
            const captured = await Promise.race([
              captureAgentSkills(a),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
            ]);
            if (!captured) return;
            const entry = {
              ...a,
              ...(captured.skills ? { skills: captured.skills } : {}),
              accessGated: captured.accessGated,
            };
            // update the in-memory result so this response carries the skills
            const idx = result.items.findIndex((x) => x.chain_id === a.chain_id && x.token_id === a.token_id);
            if (idx >= 0) result.items[idx] = { ...result.items[idx], ...entry };
            await saveShelfAgents([entry]).catch(() => {});
          } catch {
            // best effort
          }
        }),
      );
    }
  } catch {
    // capture must never break the listing
  }

  result.items = result.items.map((a) => {
    if (!firstPartyVaultOnly(Number(a.chain_id), a.token_id)) return a;
    return {
      ...a,
      x402_supported: false,
      description: firstPartyDescription(Number(a.chain_id), a.token_id) ?? a.description,
      skills: firstPartySkills(Number(a.chain_id), a.token_id) ?? a.skills,
      category: (firstPartyCategory(Number(a.chain_id), a.token_id) ?? a.category) as typeof a.category,
    };
  });

  await hydrateBoostsFromDb();

  // paid boosts sort first within the page the query already selected
  const ranked = [...result.items].sort((a, b) => {
    const ab = isBoosted(a.chain_id, a.token_id) ? 1 : 0;
    const bb = isBoosted(b.chain_id, b.token_id) ? 1 : 0;
    return bb - ab;
  });

  // the detail route asks the same durable question, so a revoke recorded
  // elsewhere cannot leave a dead session showing live on the shelf
  const sessions = ranked.map((a) => findActiveSession(a.chain_id, a.token_id));
  // revoked and edits are independent of each other and of the items mapping, so
  // read them together instead of one after the other
  const [revoked, edits] = await Promise.all([
    revokedAmong(sessions.flatMap((s) => (s ? [s.paymentId] : []))),
    loadListingEdits(),
  ]);

  const items = ranked.map((a, i) => {
    const verification = verifications.get(a.token_id);
    const shown = withListingEdit(a, edits.get(editKey(a.chain_id, a.token_id)));
    const withPcs =
      readsPancakeSwap(a.chain_id, a.token_id) || isPancakeSwapAgent(a.name, a.description ?? "")
        ? { ...shown, pcs: true }
        : shown;
    const custom = customByToken.get(String(a.token_id));
    const withCustom = custom ? { ...withPcs, isCustom: true, customAgentId: custom.id, customOnline: custom.deployment?.ok === true } : withPcs;
    const withVerification = verification ? { ...withCustom, verification } : withCustom;
    const found = sessions[i];
    const activeSession = found && !revoked.has(found.paymentId) ? found : undefined;
    const withSession = activeSession
      ? { ...withVerification, activeSession }
      : withVerification;
    return isBoosted(a.chain_id, a.token_id) ? { ...withSession, boosted: true } : withSession;
  });

  return NextResponse.json({
    success: true,
    // state the chain this catalogue is served on, so a client never has to guess it
    chainId: targetChainId(),
    ...result,
    // the catalogue's own freshness rides in indexStatus: catalogueRefreshedAt is
    // the shared store's refresh time (null when unknown) and catalogueSource says
    // whether the store or the committed snapshot is serving
    indexStatus: result.indexStatus,
    items,
    // the proof strip reads both: snapshotTotal is how many agents the committed
    // snapshot holds, registryTotal how many the registry reports for this chain
    // (null when the snapshot never recorded one), and the timestamps are the
    // freshness the server can actually attest
    snapshotTotal: result.indexStatus.snapshotTotal,
    shelved: result.indexStatus.shelved,
    registryTotal: result.indexStatus.registryTotal,
    counts: result.categoryCounts,
    snapshotTime: result.indexStatus.snapshotTime,
    lastTopUpAt: result.indexStatus.lastTopUpAt,
  }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
}
