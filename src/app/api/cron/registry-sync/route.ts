import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import { registryWatermark, syncRegistryFromChain } from "@/lib/registry-indexer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET(req: NextRequest) {
  return loggedCronRun("registry-sync", () => sync(req));
}

// the chain-read cron: decode the registry's own events and admit what passes
// the shelf gate. same fail-closed auth as the other cron routes.
async function sync(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "registry-sync is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const fromParam = Number(url.searchParams.get("from") ?? "");
  const from = Number.isInteger(fromParam) && fromParam > 0 ? fromParam : undefined;
  const maxBlocks = Number(url.searchParams.get("blocks") ?? "");
  try {
    const report = await syncRegistryFromChain({
      ...(from ? { watermarkOverride: from } : {}),
      ...(Number.isInteger(maxBlocks) && maxBlocks > 0 ? { maxBlocks } : {}),
    });
    return NextResponse.json(
      { success: !report.error, previousWatermark: await registryWatermark(), ...report },
      { status: report.error ? 502 : 200 },
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
