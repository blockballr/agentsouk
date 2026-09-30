import { NextRequest, NextResponse } from "next/server";
import { listActiveSessions } from "@/lib/x402";
import { listTasks, listTasksForPayments } from "@/lib/tasks";
import { getJobByPayment, listJobs, listJobsForClient, type Job } from "@/lib/jobs";
import {
  cancelAuthorizationDurable,
  getPaymentDurable,
  listPaymentsByClient,
  revokeSessionDurable,
} from "@/lib/receipts-store";
import type { StoredPayment } from "@/lib/x402";
import { cacheKeys, cached, invalidate, invalidatePrefix } from "@/lib/short-cache";
import { explorerBaseFor } from "@/lib/types";
import { verifyBoostOwnership } from "@/lib/boost-auth";
import { revokeRequestMessage } from "@agora/core";

export const dynamic = "force-dynamic";

// Ongoing polls every five seconds. A five second window serves at most one
// durable read per wallet per window, collapsing a poll burst onto one read.
const SESSIONS_TTL_MS = 5000;

function sameAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// The durable view of one wallet's open sessions, in the shape the page already
// renders, so an instance that never handled the settlement still lists them.
async function sessionsFromStore(client: string) {
  // A store fault or an unexpected shape must never crash the page or empty it:
  // the ledger read above still contributes whatever it holds.
  let stored: StoredPayment[] = [];
  try {
    const rows = await listPaymentsByClient(client);
    if (Array.isArray(rows)) stored = rows;
  } catch {
    return [];
  }
  const now = Date.now();
  return stored
    .filter((p) => p.activated && new Date(p.session.expiresAt).getTime() > now)
    .map((p) => ({
      paymentId: p.paymentId,
      chainId: p.agent.chainId,
      tokenId: p.agent.tokenId,
      agentName: p.agent.name,
      client: p.client,
      spendCapUsd: p.session.spendCapUsd,
      expiresAt: p.session.expiresAt,
      mode: p.mode,
      createdAt: p.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  const ledgerSessions = listActiveSessions().filter(
    (s) => !client || sameAddr(s.client, client),
  );
  // The ledger above lives in one instance's memory, so a wallet whose hires were
  // settled elsewhere would see an empty page that claims it has no hires. The
  // receipts store is the shared record, so it fills in whatever the ledger lacks.
  const durableSessions = client ? await sessionsFromStore(client) : [];
  const seenPayments = new Set(ledgerSessions.map((s) => s.paymentId));
  const sessions = [
    ...ledgerSessions,
    ...durableSessions.filter((s) => !seenPayments.has(s.paymentId)),
  ];
  const paymentIds = new Set(sessions.map((s) => s.paymentId));
  let jobs: Job[];
  let scopedTasks: Awaited<ReturnType<typeof listTasks>>;
  if (client) {
    // this wallet's own jobs and the tasks for exactly its payments, durable first,
    // so every instance answers alike and no one else's work can crowd them out
    jobs = await listJobsForClient(client, 100);
    const jobPayments = jobs.flatMap((j) => (j.paymentId ? [j.paymentId] : []));
    scopedTasks = await listTasksForPayments([...new Set([...paymentIds, ...jobPayments])]);
  } else {
    const [allTasks, allJobs] = await Promise.all([listTasks(200), listJobs(200)]);
    jobs = allJobs;
    scopedTasks = allTasks;
  }

  // newest first, so the first task seen for a payment is its latest
  const byPaymentTask = new Map<string, (typeof scopedTasks)[number]>();
  for (const t of scopedTasks) if (!byPaymentTask.has(t.paymentId)) byPaymentTask.set(t.paymentId, t);
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
  const body = (await req.json().catch(() => null)) as { client?: unknown; signature?: unknown } | null;
  const client =
    typeof body?.client === "string" ? body.client.trim() : req.nextUrl.searchParams.get("client")?.trim() ?? "";
  if (!client || !sameAddr(stored.client, client)) {
    return NextResponse.json(
      { success: false, error: "not the session owner" },
      { status: 403 },
    );
  }
  // the paymentId and client are public through the hires API, so a revoke,
  // which also drops the hire from quest progress, needs the buyer's signature
  const signature = typeof body?.signature === "string" ? body.signature : "";
  if (!signature) {
    return NextResponse.json(
      { success: false, error: "sign the revoke with the wallet that hired the agent" },
      { status: 401 },
    );
  }
  const verdict = await verifyBoostOwnership({
    message: revokeRequestMessage(paymentId, stored.client),
    signature,
    expectedOwner: stored.client,
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { success: false, error: "the signature is not from the wallet that hired the agent" },
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
