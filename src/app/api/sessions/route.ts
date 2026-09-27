import { NextRequest, NextResponse } from "next/server";
import { listActiveSessions } from "@/lib/x402";
import { listTasks } from "@/lib/tasks";
import { getJobByPayment, listJobs, type Job } from "@/lib/jobs";
import {
  cancelAuthorizationDurable,
  getPaymentDurable,
  revokeSessionDurable,
} from "@/lib/receipts-store";
import { cacheKeys, cached, invalidate, invalidatePrefix } from "@/lib/short-cache";
import { explorerBaseFor } from "@/lib/types";

export const dynamic = "force-dynamic";

// Ongoing polls every 2.5s. A five second window serves at most one durable
// scan per wallet per window, collapsing a poll burst onto one read, while the
// view never trails the poll cadence by more than two intervals.
const SESSIONS_TTL_MS = 5000;

function sameAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// GET /api/sessions?client=... joined view for the Ongoing page; with client, only that
// wallet's hire sessions, jobs, and tasks are returned

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client")?.trim() ?? "";
  const body = await cached(cacheKeys.sessions(client), SESSIONS_TTL_MS, () =>
    ongoingBundle(client),
  );
  return NextResponse.json(body);
}

async function ongoingBundle(client: string) {
  const sessions = listActiveSessions().filter(
    (s) => !client || sameAddr(s.client, client),
  );
  // Two independent reads, run together so a cache miss pays one round trip.
  const [allTasks, allJobs] = await Promise.all([listTasks(200), listJobs(200)]);
  const jobs = allJobs.filter((j) => !client || sameAddr(j.client, client));
  const paymentIds = new Set(sessions.map((s) => s.paymentId));
  const scopedTasks = client
    ? allTasks.filter(
        (t) =>
          paymentIds.has(t.paymentId) ||
          jobs.some((j) => j.paymentId === t.paymentId),
      )
    : allTasks;

  const byPaymentTask = new Map(scopedTasks.map((t) => [t.paymentId, t]));
  const byPaymentJob = new Map(
    jobs.filter((j) => j.paymentId).map((j) => [j.paymentId as string, j]),
  );
  const jobFor = (paymentId: string): Job | null =>
    byPaymentJob.get(paymentId) ?? getJobByPayment(paymentId) ?? null;

  const ongoing = sessions.map((s) => ({
    session: s,
    task: byPaymentTask.get(s.paymentId) ?? null,
    job: jobFor(s.paymentId),
  }));

  const recentTasks = scopedTasks
    .filter((t) => !paymentIds.has(t.paymentId))
    .slice(0, 12)
    .map((t) => ({
      task: t,
      session: null,
      job: jobFor(t.paymentId),
    }));

  return {
    success: true,
    client: client || null,
    sessions: ongoing,
    recentTasks,
    counts: {
      activeHires: ongoing.length,
      running: scopedTasks.filter((t) => t.status === "running").length,
      ready: scopedTasks.filter((t) => t.status === "ready").length,
      delivered: scopedTasks.filter((t) => t.status === "delivered").length,
      failed: scopedTasks.filter((t) => t.status === "failed" || t.status === "gated").length,
      jobsFunded: jobs.filter((j) => j.status === "Funded").length,
      jobsSubmitted: jobs.filter((j) => j.status === "Submitted").length,
      jobsCompleted: jobs.filter((j) => j.status === "Completed").length,
    },
  };
}

export async function DELETE(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get("paymentId")?.trim() ?? "";
  if (!paymentId) {
    return NextResponse.json(
      { success: false, error: "paymentId required" },
      { status: 400 },
    );
  }
  const stored = await getPaymentDurable(paymentId);
  if (!stored) {
    return NextResponse.json(
      { success: false, error: "unknown paymentId" },
      { status: 404 },
    );
  }
  const client = req.nextUrl.searchParams.get("client")?.trim() ?? "";
  if (!client || !sameAddr(stored.client, client)) {
    return NextResponse.json(
      { success: false, error: "not the session owner" },
      { status: 403 },
    );
  }
  const revoked = await revokeSessionDurable(paymentId);
  if (!revoked) {
    return NextResponse.json(
      { success: false, error: "unknown paymentId" },
      { status: 404 },
    );
  }
  // A revoke must be visible on the very next read, so drop the session list
  // and the wallet's hire list rather than let the cache serve the old view.
  invalidatePrefix(cacheKeys.sessionsPrefix);
  invalidate(cacheKeys.hires(client));
  // the ledger revoke above is the guarantee; the chain cancel is best-effort and
  // reported separately so a failure is never dressed up as a cancellation
  const onchain = await cancelAuthorizationDurable(paymentId);
  const txLink =
    onchain.txHash && onchain.chainId
      ? `${explorerBaseFor(onchain.chainId)}/tx/${onchain.txHash}`
      : undefined;
  return NextResponse.json({ success: true, paymentId, onchain: { ...onchain, txLink } });
}
