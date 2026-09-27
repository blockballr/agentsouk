import { NextRequest, NextResponse } from "next/server";
import { canRetry, getTask, nextRetryDelayMs } from "@/lib/tasks";
import { deliver } from "@/lib/delivery";
import { enforceRateLimit, type RateLimitVerdict } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Retries stop after three attempts, so ten an hour per task only catches
// concurrent duplicates while leaving every genuine retry through.
const RETRY_RATE = {
  table: "task_retry_rate_limits",
  limit: 10,
  windowMs: 60 * 60 * 1000,
};

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

  // cap the repeated work before the delivery runs; unknown task ids never
  // reach here, so a spray of guesses creates no counters
  let rate: RateLimitVerdict;
  try {
    rate = await enforceRateLimit(RETRY_RATE, {
      keys: [`task:${taskId.slice(0, 128)}`],
    });
  } catch {
    return NextResponse.json(
      { error: "Retry is temporarily unavailable, please try again shortly." },
      { status: 503 },
    );
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many retries for this task. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
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
