import { NextRequest, NextResponse } from "next/server";
import { formatUnits } from "viem";
import { fetchAgentDetail } from "@/lib/scanner";
import { loadDelisted } from "@/lib/delist-store";
import { targetChainId } from "@/lib/types";
import { erc8183Stack, kernelJob, notifySeller } from "@/lib/jobs8183";
import { recordOnchainJob, findOnchainJobForClient } from "@/lib/jobs";

export const dynamic = "force-dynamic";

// POST /api/jobs8183/jobs  {chainId?, tokenId, kernelJobId, client, task}
// The buyer reports a funded kernel job: the route verifies the chain's own
// answer (client, provider, Funded) before recording anything, then notifies
// the seller's notify_funded skill and stores the reply as evidence, while
// the recorded row carries only what the chain says.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    chainId?: number;
    tokenId?: string;
    kernelJobId?: number;
    client?: string;
  } | null;
  const tokenId = typeof body?.tokenId === "string" || typeof body?.tokenId === "number" ? String(body.tokenId) : "";
  if (!body || !/^\d{1,78}$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "tokenId required" }, { status: 400 });
  }
  const kernelJobId = Number(body.kernelJobId);
  if (!Number.isSafeInteger(kernelJobId) || kernelJobId < 1) {
    return NextResponse.json({ success: false, error: "kernelJobId must be a positive integer" }, { status: 400 });
  }
  const client = typeof body.client === "string" ? body.client : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(client)) {
    return NextResponse.json({ success: false, error: "client must be a wallet address" }, { status: 400 });
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
      { success: false, offMarket: true, error: `${detail.name} is off the market, so this job is not recorded.` },
      { status: 409 },
    );
  }
  const provider = detail.agent_wallet ?? detail.owner_address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(provider)) {
    return NextResponse.json({ success: false, error: `${detail.name} names no wallet to work for the job.` }, { status: 409 });
  }

  const onchain = await kernelJob(chainId, kernelJobId);
  if (!onchain || onchain.status !== 1) {
    return NextResponse.json(
      { success: false, error: `kernel job ${kernelJobId} is not Funded on chain ${chainId}` },
      { status: 409 },
    );
  }
  if (onchain.client.toLowerCase() !== client.toLowerCase()) {
    return NextResponse.json(
      { success: false, error: `kernel job ${kernelJobId} was created by ${onchain.client}, not this wallet` },
      { status: 409 },
    );
  }
  if (onchain.provider.toLowerCase() !== provider.toLowerCase()) {
    return NextResponse.json(
      { success: false, error: `kernel job ${kernelJobId} names ${onchain.provider} as its provider, not this listing's wallet` },
      { status: 409 },
    );
  }

  const job = await recordOnchainJob({
    onchainJobId: kernelJobId,
    client: onchain.client,
    provider: onchain.provider,
    evaluator: onchain.evaluator,
    description: onchain.description,
    chainId,
    tokenId: detail.token_id,
    agentName: detail.name,
    budgetUsd: Number(formatUnits(onchain.budget, 18)),
    expiredAt: new Date(Number(onchain.expiredAt) * 1000).toISOString(),
  });

  const notify = await notifySeller(chainId, detail.a2a_endpoint ?? "", {
    job_id: kernelJobId,
    commerce: stack.commerce,
    payment_token: stack.paymentToken,
    provider: onchain.provider,
    client: onchain.client,
    budget: onchain.budget.toString(),
  });

  return NextResponse.json({
    success: true,
    recorded: { id: job.id, onchainJobId: kernelJobId, agent: detail.name, status: job.status },
    notify,
  });
}

// GET /api/jobs8183/jobs?wallet=0x..
// The wallet's recorded kernel jobs; each row's status is re-read from the
// kernel so the page never has to trust a stale record
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ success: false, error: "wallet required" }, { status: 400 });
  }
  const rows = (await findOnchainJobForClient(wallet)).slice(0, 20);
  const out = [];
  for (const row of rows) {
    const onchain = await kernelJob(Number(row.chainId), Number(row.onchainJobId)).catch(() => null);
    out.push({
      id: row.id,
      onchainJobId: row.onchainJobId,
      chainId: row.chainId,
      tokenId: row.tokenId,
      agentName: row.agentName,
      budgetUsd: row.budgetUsd,
      expiredAt: row.expiredAt,
      status: onchain ? onchain.status : null,
      updatedAt: row.updatedAt,
    });
  }
  return NextResponse.json({ success: true, jobs: out });
}
