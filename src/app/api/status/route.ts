import { NextResponse } from "next/server";
import { loadCatalogueMeta, shelfStoreMode } from "@/lib/shelf-store";
import { readFreshness } from "@/lib/freshness";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const chainId = targetChainId();
  const now = Date.now();
  const catalogue = await loadCatalogueMeta(chainId);
  const freshness = readFreshness(catalogue?.refreshedAt ?? null, now, 15 * 60_000, 30 * 60_000);

  return NextResponse.json({
    data: {
      chainId,
      store: shelfStoreMode(),
      jobs: [
        {
          name: "catalogue",
          lastRun: catalogue?.refreshedAt ?? null,
          block: catalogue?.refreshedBlock ?? null,
          registryTotal: catalogue?.registryTotal ?? null,
          shelfSize: catalogue?.shelfSize ?? null,
          freshness,
        },
      ],
    },
    error: catalogue ? null : "catalogue has not recorded a refresh",
    meta: {
      checkedAt: new Date(now).toISOString(),
      freshness,
    },
  });
}
