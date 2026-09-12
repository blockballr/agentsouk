import { NextRequest, NextResponse } from "next/server";
import { canRetry, getTask, nextRetryDelayMs } from "@/lib/tasks";
import { getAgentMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  return NextResponse.json({
    task,
    retry: canRetry(task) ? { allowed: true, delayMs: nextRetryDelayMs(task) } : { allowed: false },
    metrics: getAgentMetrics(task.tokenId),
  });
}
