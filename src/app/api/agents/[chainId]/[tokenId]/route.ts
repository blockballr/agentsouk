import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken, queryAgents, recordShelfSkills } from "@/lib/scanner";
import { loadVerifications } from "@/lib/verifications";
import { isPancakeSwapAgent, readsPancakeSwap } from "@/lib/pancakeswap";
import { findActiveSession } from "@/lib/x402";
import { sessionRevoked } from "@/lib/receipts-store";
import { getBoost, hydrateBoostsFromDb } from "@/lib/boosts";
import { captureAgentSkills } from "@/lib/agent-interface";
import { firstPartyCategory, firstPartyMinDeposit, firstPartySkills } from "@/lib/first-party-copy";
import type { AgentSummary } from "@agora/core";
import { readPancakePositions } from "@/lib/pancake-positions";
import { withListingEdit } from "@/lib/listing-edit";
import { editKey, loadListingEdits } from "@/lib/listing-edit-store";

export const dynamic = "force-dynamic";

// GET /api/agents/[chainId]/[tokenId]
// fresh registry fetch with snapshot fallback, served to the Vite app

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
) {
  const { chainId, tokenId } = await params;
  const agent = await getAgentByToken(Number(chainId), tokenId);
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }
  // the wallet the agent registered, read for PancakeSwap v3 positions while the rest of the
  // page loads; never the owner's, whose personal activity is not the agent's
  const wallet = "agent_wallet" in agent ? agent.agent_wallet : null;
  const positions = readPancakePositions(Number(chainId), wallet);
  const verifications = await loadVerifications(Number(chainId));
  await hydrateBoostsFromDb();
  const verification = verifications.get(agent.token_id);
  // the card is the registry document the owner published; its skills are
  // authoritative. the index's flattened list (often the MCP tool list) only
  // fills in when the card declares none.
  const captured = await captureAgentSkills(agent).catch(() => null);
  const canonicalSkills = firstPartySkills(Number(chainId), tokenId);
  const skills = canonicalSkills ?? (captured?.skills?.length ? captured.skills : (agent.skills ?? undefined));
  const accessGated = agent.accessGated ?? captured?.accessGated ?? false;
  // the shelf's category is the tab the listing sits under, which a re-read of its text can miss
  const shelved = (await queryAgents({ limit: 5000, includeHouse: true, includeDelisted: true })).items.find(
    (a) => a.token_id === agent.token_id,
  );
  // the card is authoritative, so a listing whose card changed after admission
  // (for example one that added the ERC-8183 job steps) teaches the shelf here
  // rather than waiting for the next background refresh
  const storedSkillIds = (shelved?.skills ?? []).map((s) => s.id ?? s.name).join(",");
  const liveSkillIds = (skills ?? []).map((s) => s.id ?? s.name).join(",");
  if (skills?.length && storedSkillIds !== liveSkillIds) {
    await recordShelfSkills(Number(chainId), tokenId, skills, accessGated).catch(() => {});
  }
  const canonicalCategory = firstPartyCategory(Number(chainId), tokenId);
  const categorised = canonicalCategory
    ? { ...agent, category: canonicalCategory as AgentSummary["category"] }
    : shelved?.category
      ? { ...agent, category: shelved.category }
      : agent;
  const data = verification ? { ...categorised, verification } : categorised;
  const withSkills = skills ? { ...data, skills } : data;
  const withAccess = accessGated ? { ...withSkills, accessGated: true } : withSkills;
  const withPcs =
    readsPancakeSwap(Number(chainId), tokenId) || isPancakeSwapAgent(agent.name, agent.description ?? "")
      ? { ...withAccess, pcs: true }
      : withAccess;
  const found = findActiveSession(Number(chainId), tokenId);
  // a revoke recorded on another instance never reaches this ledger, so the
  // durable receipt decides whether the page is still offered run controls
  const activeSession = found && !(await sessionRevoked(found.paymentId)) ? found : undefined;
  const boost = getBoost(Number(chainId), tokenId);
  const withBoost = boost
    ? { ...withPcs, boosted: true, boostExpiresAt: boost.expiresAt }
    : withPcs;
  const held = await positions;
  // only positions that exist are shown; a failed read and an empty wallet both say nothing
  const positioned = held && held.held + held.staked > 0 ? { ...withBoost, pancakeswapPositions: held } : withBoost;
  // the owner's wording, examples and image go on last, with the registry's own kept beside them
  const edits = await loadListingEdits();
  const withPositions = withListingEdit(positioned, edits.get(editKey(Number(chainId), agent.token_id)));
  // the first-party registry is authoritative for our own agents; a third-party
  // agent's card supplies the term when it publishes one
  const minDeposit = firstPartyMinDeposit(Number(chainId), tokenId) ?? captured?.vaultMinDepositUsd ?? null;
  const withVault = minDeposit != null ? { ...withPositions, vaultMinDepositUsd: minDeposit } : withPositions;
  return NextResponse.json(
    {
      data: activeSession ? { ...withVault, activeSession } : withVault,
    },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
  );
}
