import { NextRequest, NextResponse } from "next/server";
import {
  claimRefund,
  completeJob,
  getJob,
  rejectJob,
  submitJob,
} from "@/lib/jobs";

export const dynamic = "force-dynamic";

// GET /api/jobs/[jobId]
// POST action: complete | reject | submit | claimRefund

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  return NextResponse.json({ success: true, job });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    by?: string;
    reason?: string;
    deliverable?: string;
  } | null;

  const action = body?.action;
  const by = body?.by || "browser";

  if (action === "complete") {
    const job = completeJob({ jobId, evaluator: by, reason: body?.reason });
    if (!job) return NextResponse.json({ error: "complete rejected" }, { status: 403 });
    return NextResponse.json({ success: true, job });
  }
  if (action === "reject") {
    const job = rejectJob({ jobId, by, reason: body?.reason });
    if (!job) return NextResponse.json({ error: "reject rejected" }, { status: 403 });
    return NextResponse.json({ success: true, job });
  }
  if (action === "submit") {
    const job = submitJob({
      jobId,
      provider: by,
      deliverable: body?.deliverable ?? "",
    });
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    return NextResponse.json({ success: true, job });
  }
  if (action === "claimRefund") {
    const job = claimRefund(jobId, by);
    if (!job) return NextResponse.json({ error: "refund not allowed yet" }, { status: 400 });
    return NextResponse.json({ success: true, job });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
