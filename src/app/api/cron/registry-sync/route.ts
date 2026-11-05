import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import { registryWatermark, syncRegistryFromChain, syncReputationFromChain } from "@/lib/registry-indexer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET(req: NextRequest) {
  return loggedCronRun("registry-sync", () => sync(req));
}

// the chain-read cron: decode the identity and reputation registries' own
// events and let the shelf gate absorb what changed. same fail-closed auth as
// the other cron routes.
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
  const blocksParam = Number(url.searchParams.get("blocks") ?? "");
  const blocks = Number.isInteger(blocksParam) && blocksParam > 0 ? blocksParam : undefined;

  try {
    const identity = await syncRegistryFromChain({
      ...(from ? { watermarkOverride: from } : {}),
      ...(blocks ? { maxBlocks: blocks } : {}),
    });
    const reputation = await syncReputationFromChain(blocks ? { maxBlocks: blocks } : {});
    // a resumed window is partial success by design: the watermark keeps the
    // coverage continuous, so only a total rpc read is a red run
    const resumed = (r: { error?: string }) => typeof r?.error === "string" && r.error.includes("resumed at block");
    const ok = !(identity.error && !resumed(identity)) && !(reputation.error && !resumed(reputation));
    return NextResponse.json(
      {
        success: ok,
        previousWatermark: await registryWatermark(),
        identity,
        reputation,
      },
      { status: ok ? 200 : 502 },
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
