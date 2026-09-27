import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import {
  claimRefund,
  completeJob,
  getJob,
  getJobAsync,
  jobActionMessage,
  rejectJob,
  submitJob,
  type Job,
} from "@/lib/jobs";

export const dynamic = "force-dynamic";

// GET /api/jobs/[jobId]
// POST action: complete | reject | submit | claimRefund, signed by the required party

const ACTIONS = ["complete", "reject", "submit", "claimRefund"] as const;
type JobAction = (typeof ACTIONS)[number];

// Who must sign, given the job state. A null required signer means the state does
// not allow the action at all, which is a 409 rather than a 200 on the unchanged job.
function requiredSigner(job: Job, action: JobAction): string | null {
  if (action === "complete") {
    return job.status === "Submitted" ? job.evaluator : null;
  }
  if (action === "reject") {
    if (job.status === "Open") return job.client;
    if (job.status === "Funded" || job.status === "Submitted") return job.evaluator;
    return null;
  }
  if (action === "submit") {
    return job.status === "Funded" ? job.provider : null;
  }
  // claimRefund is the client's, and only once the job has expired with work still open
  if (job.status !== "Funded" && job.status !== "Submitted") return null;
  if (Date.now() < new Date(job.expiredAt).getTime()) return null;
  return job.client;
}

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
    signature?: string;
  } | null;

  const action = body?.action;
  if (!action || !ACTIONS.includes(action as JobAction)) {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const jobAction = action as JobAction;

  // The action has to see a job another instance created, so it reads through to
  // the durable store rather than only this process's map, which is what made a
  // submitted job answer "job not found" when the panel asked to complete it.
  const job = await getJobAsync(jobId);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const required = requiredSigner(job, jobAction);
  if (!required) {
    return NextResponse.json(
      { error: `job is ${job.status}, the ${jobAction} action is not allowed` },
      { status: 409 },
    );
  }

  const by = body?.by;
  const signature = body?.signature;
  if (!by || !signature) {
    return NextResponse.json({ error: "a signed request is required" }, { status: 401 });
  }

  // the caller must control the address the action requires, checked before any state change
  if (by.toLowerCase() !== required.toLowerCase()) {
    return NextResponse.json({ error: "signature does not authorize this action" }, { status: 401 });
  }

  const message = jobActionMessage({
    jobId,
    action: jobAction,
    address: by,
    reason: body?.reason,
    deliverable: body?.deliverable,
  });
  let signatureMatches = false;
  try {
    signatureMatches = await verifyMessage({
      address: by as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    signatureMatches = false;
  }
  if (!signatureMatches) {
    return NextResponse.json({ error: "signature does not authorize this action" }, { status: 401 });
  }

  if (jobAction === "complete") {
    const next = completeJob({ jobId, evaluator: by, reason: body?.reason });
    if (!next) return NextResponse.json({ error: "complete rejected" }, { status: 403 });
    return NextResponse.json({ success: true, job: next });
  }
  if (jobAction === "reject") {
    const next = rejectJob({ jobId, by, reason: body?.reason });
    if (!next) return NextResponse.json({ error: "reject rejected" }, { status: 403 });
    return NextResponse.json({ success: true, job: next });
  }
  if (jobAction === "submit") {
    const next = submitJob({
      jobId,
      provider: by,
      deliverable: body?.deliverable ?? "",
    });
    if (!next) return NextResponse.json({ error: "submit rejected" }, { status: 403 });
    return NextResponse.json({ success: true, job: next });
  }
  const next = claimRefund(jobId, by);
  if (!next) return NextResponse.json({ error: "refund not allowed yet" }, { status: 409 });
  return NextResponse.json({ success: true, job: next });
}
