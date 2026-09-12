import { NextRequest, NextResponse } from "next/server";
import {
  createHireTask,
  getTask,
  getTaskByPaymentAsync,
  listTasks,
} from "@/lib/tasks";

export const dynamic = "force-dynamic";

// GET /api/tasks?paymentId=... or GET /api/tasks
// POST /api/tasks - create a task for a settled payment (idempotent per payment)

export async function GET(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get("paymentId");
  if (paymentId) {
    const task = await getTaskByPaymentAsync(paymentId);
    return NextResponse.json({ tasks: task ? [task] : [] });
  }
  return NextResponse.json({ tasks: await listTasks() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    paymentId?: string;
    chainId?: number;
    tokenId?: string;
    agentName?: string;
  } | null;

  if (!body?.paymentId || !body?.tokenId) {
    return NextResponse.json(
      { success: false, error: "paymentId and tokenId required" },
      { status: 400 },
    );
  }

  const task = createHireTask({
    paymentId: body.paymentId,
    chainId: Number(body.chainId ?? 56),
    tokenId: body.tokenId,
    agentName: body.agentName ?? "Agent",
  });
  return NextResponse.json({ success: true, task: getTask(task.id) }, { status: 201 });
}
