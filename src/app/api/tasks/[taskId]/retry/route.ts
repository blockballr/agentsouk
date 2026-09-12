import { NextRequest, NextResponse } from "next/server";
import { canRetry, getTask, nextRetryDelayMs } from "@/lib/tasks";
import { deliver } from "@/lib/delivery";

export const dynamic = "force-dynamic";

// POST /api/tasks/[taskId]/retry - re-run the last delivery for a failed task

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  if (!canRetry(task)) {
    return NextResponse.json(
      { error: "retry not allowed", status: task.status, attempts: task.attempts },
      { status: 400 },
    );
  }

  const outcome = await deliver({
    paymentId: task.paymentId,
    tool: task.tool,
    args: task.args,
    task: task.taskText,
    taskId,
  });

  const after = getTask(taskId);
  return NextResponse.json({
    task: after,
    retryDelayMs: nextRetryDelayMs(task),
    outcome,
  });
}
