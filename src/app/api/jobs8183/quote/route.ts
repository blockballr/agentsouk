import { NextRequest, NextResponse } from "next/server";
import { takesJobs } from "@agora/core";
import { fetchAgentDetail } from "@/lib/scanner";
import { fetchAgentCardSkills } from "@/lib/delivery";
import { loadDelisted } from "@/lib/delist-store";
import { isAgentOwner } from "@/lib/boost-auth";
import { targetChainId } from "@/lib/types";
import { erc8183Stack, negotiateQuote } from "@/lib/jobs8183";

export const dynamic = "force-dynamic";

const TASK_MAX = 2000;

// POST /api/jobs8183/quote {chainId?, tokenId, task}
// The negotiate step of the ERC-8183 buy flow. The marketplace dials the
// seller's own a2a endpoint with the task and returns the signed quote,
// validated against the kernel's payment token, the listing's registry wallet
// and the clock, alongside the contracts the fund step will target. Guards
// mirror the hire route's, because a job seller funds just as much as a hire.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    chainId?: number;
    tokenId?: string;
    task?: string;
    client?: string;
  } | null;

  const tokenId = typeof body?.tokenId === "string" || typeof body?.tokenId === "number" ? String(body.tokenId) : "";
  if (!body || !/^\d{1,78}$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "tokenId required" }, { status: 400 });
  }
  const task = typeof body.task === "string" ? body.task.trim() : "";
  if (!task || task.length > TASK_MAX) {
    return NextResponse.json({ success: false, error: `task required, up to ${TASK_MAX} characters` }, { status: 400 });
  }
  const chainId = body.chainId === undefined || body.chainId === null ? targetChainId() : Number(body.chainId);
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    return NextResponse.json({ success: false, error: "chainId must be a chain id" }, { status: 400 });
  }

  const stack = erc8183Stack(chainId);
  if (!stack) {
    return NextResponse.json(
      { success: false, error: `the ERC-8183 kernel is not deployed on chain ${chainId}` },
      { status: 404 },
    );
  }

  const detail = await fetchAgentDetail(chainId, tokenId);
  if (!detail) {
    return NextResponse.json({ success: false, error: "agent not found" }, { status: 404 });
  }
  const offMarket = await loadDelisted().catch(() => new Set<string>());
  if (offMarket.has(String(detail.token_id))) {
    return NextResponse.json(
      { success: false, offMarket: true, error: `${detail.name} is off the market, so it is not quoting jobs.` },
      { status: 409 },
    );
  }
  const client = typeof body.client === "string" ? body.client : "";
  if (client && isAgentOwner(client, detail)) {
    return NextResponse.json(
      {
        success: false,
        ownAgent: true,
        error: `${detail.name} is your own agent, so this wallet cannot quote jobs on it.`,
      },
      { status: 409 },
    );
  }
  // the live registry read carries no skills, so the card is read as the agent page reads it
  const skills = detail.skills ?? (detail.a2a_endpoint ? await fetchAgentCardSkills(detail.a2a_endpoint, 4000) : null);
  if (!takesJobs(skills)) {
    return NextResponse.json(
      { success: false, notAJobSeller: true, error: `${detail.name} does not take ERC-8183 jobs on its card.` },
      { status: 409 },
    );
  }

  const expectedProvider = detail.agent_wallet ?? detail.owner_address;
  const result = await negotiateQuote(chainId, detail.a2a_endpoint ?? "", task, expectedProvider);
  return NextResponse.json(
    {
      success: result.ok,
      ...(result.ok
        ? {
            quote: {
              price: result.quote.price.toString(),
              currency: result.quote.currency,
              providerAddress: result.quote.providerAddress,
              validUntil: result.quote.validUntil,
              negotiationHash: result.quote.negotiationHash,
              providerSig: result.quote.providerSig,
              agentId: result.quote.agentId,
            },
          }
        : { error: result.error }),
      stack,
      agent: { token_id: detail.token_id, name: detail.name },
    },
    { status: result.ok ? 200 : 502 },
  );
}
