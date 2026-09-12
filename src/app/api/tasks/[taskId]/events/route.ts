import { NextRequest } from "next/server";
import { getTask } from "@/lib/tasks";

export const dynamic = "force-dynamic";

// GET /api/tasks/[taskId]/events
// SSE stream of task status; closes on terminal state or client abort

const TERMINAL = new Set(["delivered", "failed", "gated"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const initial = getTask(taskId);
      if (!initial) {
        send({ error: "task not found" });
        controller.close();
        return;
      }
      send({ task: initial });

      const interval = setInterval(() => {
        const current = getTask(taskId);
        if (!current) {
          clearInterval(interval);
          controller.close();
          return;
        }
        send({ task: current });
        if (TERMINAL.has(current.status)) {
          clearInterval(interval);
          controller.close();
        }
      }, 1000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
