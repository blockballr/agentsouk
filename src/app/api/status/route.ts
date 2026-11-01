import { NextResponse } from "next/server";
import { loadCatalogueMeta, shelfStoreMode } from "@/lib/shelf-store";
import { readFreshness } from "@/lib/freshness";
import { readNetwork } from "@/lib/network-reading";
import { loadVerifications } from "@/lib/verifications";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const chainId = targetChainId();
  const now = Date.now();

  const [catalogue, network, verifications] = await Promise.all([
    loadCatalogueMeta(chainId),
    readNetwork(chainId).catch(() => null),
    loadVerifications(chainId).catch(() => new Map()),
  ]);

  const catalogueFreshness = readFreshness(catalogue?.refreshedAt ?? null, now, 15 * 60_000, 30 * 60_000);
  const networkCheckedAt = network?.reading.checkedAt ?? null;
  const networkFreshness = readFreshness(networkCheckedAt, now);

  let latestCheck: string | null = null;
  let online = 0;
  for (const v of verifications.values()) {
    if (v.checkedAt && (!latestCheck || v.checkedAt > latestCheck)) latestCheck = v.checkedAt;
    if (v.status === "online" || v.status === "delivered") online += 1;
  }
  const verificationFreshness = readFreshness(latestCheck, now, 6 * 60 * 60_000, 12 * 60 * 60_000);

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
          freshness: catalogueFreshness,
        },
        {
          name: "network",
          lastRun: networkCheckedAt,
          block: network?.reading.block ?? null,
          price: network?.reading.price ?? null,
          tps: network?.reading.tps ?? null,
          error: network?.reading.error ?? null,
          freshness: networkFreshness,
        },
        {
          name: "verification",
          lastRun: latestCheck,
          total: verifications.size,
          online,
          freshness: verificationFreshness,
        },
      ],
    },
    error: catalogue ? null : "catalogue has not recorded a refresh",
    meta: {
      checkedAt: new Date(now).toISOString(),
      freshness: catalogueFreshness,
    },
  });
}
