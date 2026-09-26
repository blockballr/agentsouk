import { NextRequest, NextResponse } from "next/server";
import { createJob, getJob, listJobs } from "@/lib/jobs";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/jobs - list recent ERC-8183 jobs
// POST /api/jobs - create an Open job (client = wallet or "browser")

export async function GET(req: NextRequest) {
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));
  return NextResponse.json({ success: true, jobs: await listJobs(limit) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    client?: string;
    provider?: string;
    evaluator?: string;
    description?: string;
    chainId?: number;
    tokenId?: string;
    agentName?: string;
    budgetUsd?: number;
    expiredAt?: string;
  } | null;

  if (!body?.tokenId || !body?.provider) {
    return NextResponse.json(
      { success: false, error: "tokenId and provider required" },
      { status: 400 },
    );
  }

  const job = createJob({
    client: body.client || "browser",
    provider: body.provider,
    evaluator: body.evaluator,
    description: body.description ?? `Hire ${body.agentName ?? body.tokenId}`,
    chainId: Number(body.chainId ?? targetChainId()),
    tokenId: body.tokenId,
    agentName: body.agentName ?? `Agent ${body.tokenId}`,
    budgetUsd: Number(body.budgetUsd ?? 2),
    expiredAt: body.expiredAt,
  });
  return NextResponse.json({ success: true, job: getJob(job.id) }, { status: 201 });
}
