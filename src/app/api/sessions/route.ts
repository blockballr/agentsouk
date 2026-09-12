import { NextRequest, NextResponse } from "next/server";
import { listActiveSessions } from "@/lib/x402";
import { listTasks } from "@/lib/tasks";
import { getJobByPayment, listJobs, type Job } from "@/lib/jobs";

export const dynamic = "force-dynamic";

function sameAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// GET /api/sessions?client=0x...
// joined view for the Ongoing page. When client is provided, only that wallet's
// hire sessions, jobs, and tasks are returned (per-user, not a global feed).

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client")?.trim() ?? "";
  const sessions = listActiveSessions().filter(
    (s) => !client || sameAddr(s.client, client),
  );
  const allTasks = await listTasks(200);
  const tasks = allTasks.filter((t) => {
    if (!client) return true;
    return sessions.some((s) => s.paymentId === t.paymentId);
  });
  const allJobs = await listJobs(200);
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

  return NextResponse.json({
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
  });
}
