import { NextRequest, NextResponse } from "next/server";
import { resolveAgentName } from "@/lib/agent-name";
import { createJob, getJob, getJobByPaymentFresh, listJobs } from "@/lib/jobs";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/jobs - list recent ERC-8183 jobs
// POST /api/jobs - create an Open job (client = wallet or "browser")

async function namedJob(job: ReturnType<typeof getJob>) {
  if (!job) return job;
  return {
    ...job,
    agentName:
      (await resolveAgentName(job.chainId, job.tokenId, job.agentName)) ??
      job.agentName,
  };
}

export async function GET(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get("paymentId")?.trim();
  // one hire's job, so a page reload can restore the run pane it already earned
  if (paymentId) {
    const job = await getJobByPaymentFresh(paymentId);
    return NextResponse.json({ success: true, jobs: job ? [await namedJob(job)] : [] });
  }
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));
  const jobs = await listJobs(limit);
  return NextResponse.json({ success: true, jobs: await Promise.all(jobs.map(namedJob)) });
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

  const chainId = Number(body.chainId ?? targetChainId());
  const agentName =
    (await resolveAgentName(chainId, body.tokenId, body.agentName)) ||
    `Agent #${body.tokenId}`;
  const job = createJob({
    client: body.client || "browser",
    provider: body.provider,
    evaluator: body.evaluator,
    description: body.description ?? `Hire ${agentName}`,
    chainId,
    tokenId: body.tokenId,
    agentName,
    budgetUsd: Number(body.budgetUsd ?? 2),
    expiredAt: body.expiredAt,
  });
  return NextResponse.json({ success: true, job: getJob(job.id) }, { status: 201 });
}
