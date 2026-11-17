import { NextRequest, NextResponse } from "next/server";
import { formatUnits } from "viem";
import { jobsForProviders } from "@/lib/job-index";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/jobs8183/to-deliver?providers=0x..,0x..
// a seller's open pay-on-delivery jobs, read from the chain-wide job index by the wallets their
// agents work from: funded and waiting for the work (1), or delivered and waiting for the buyer (2).
// the index is public chain data, so this needs no proof
const FUNDED = 1;
const SUBMITTED = 2;

export async function GET(req: NextRequest) {
  const providers = (req.nextUrl.searchParams.get("providers") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => /^0x[0-9a-fA-F]{40}$/.test(p))
    .slice(0, 50);
  if (providers.length === 0) return NextResponse.json({ success: false, error: "providers required" }, { status: 400 });
  const chainId = targetChainId();
  const now = Math.floor(Date.now() / 1000);
  const rows = await jobsForProviders(chainId, providers).catch(() => []);
  const open = rows
    .filter((j) => (j.status === FUNDED || j.status === SUBMITTED) && j.expiredAt > now)
    .sort((a, b) => a.expiredAt - b.expiredAt)
    .slice(0, 50)
    .map((j) => ({
      chainId: j.chainId,
      jobId: j.jobId,
      provider: j.provider,
      client: j.client,
      budgetUsd: Number(formatUnits(BigInt(j.budget), 18)),
      stage: j.status === FUNDED ? "deliver" : "awaiting_buyer",
      expiresAt: new Date(j.expiredAt * 1000).toISOString(),
      submittedAt: j.submittedAt > 0 ? new Date(j.submittedAt * 1000).toISOString() : null,
    }));
  return NextResponse.json({ success: true, chainId, jobs: open }, { headers: { "cache-control": "no-store" } });
}
