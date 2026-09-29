import { NextResponse } from "next/server";
import { listJobsForClient } from "@/lib/jobs";
import { listProdClients } from "@/lib/receipts-store";
import { baseUrl } from "@/lib/verify-candidate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The wallets that have completed the Set and Earn quest: a settled hire in each of
// the four categories, plus one admitted listing of their own. Each verdict is read
// from /api/quest/progress rather than recomputed here, so the exclusions that decide
// it live in one place and cannot drift from the per wallet answer the profile shows.

interface QuestHire {
  category: string | null;
  tokenId: string;
  agentName: string;
  txHash: string | null;
  createdAt: string;
}

interface Verdict {
  wallet: string;
  categories: Record<string, boolean>;
  hires: QuestHire[];
  listings: { tokenId: string; name: string; category: string }[];
  completed: boolean;
}

async function verdictFor(wallet: string): Promise<Verdict | null> {
  try {
    const res = await fetch(
      `${baseUrl()}/api/quest/progress?wallet=${encodeURIComponent(wallet)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Verdict & { success?: boolean };
    return body?.success ? body : null;
  } catch {
    return null;
  }
}

// When the last of the four categories was hired, so the list runs in the order the
// quest does: first to complete, first on the list.
function completedAt(hires: QuestHire[]): string | null {
  const dated = hires.filter((h) => h.category).map((h) => h.createdAt).sort();
  return dated.length > 0 ? dated[dated.length - 1] : null;
}

// Runs the verdicts a few at a time. Each one is an HTTP call that itself reads the
// catalogue, so an unbounded Promise.all would open one per candidate at once.
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

export async function GET() {
  const { candidates, source } = await listProdClients();
  // Four categories cannot be completed in fewer than four hires, so a candidate
  // below that is skipped without any read of its own.
  const possible = candidates.filter((c) => c.hires >= 4);
  const verdicts = await mapLimited(possible, 8, (c) => verdictFor(c.wallet));

  const completed = [];
  for (const v of verdicts) {
    if (!v?.completed) continue;
    const wallet = String(v.wallet);
    const hires = v.hires ?? [];
    const jobs = await listJobsForClient(wallet);
    completed.push({
      wallet,
      completedAt: completedAt(hires),
      categories: v.categories,
      hires: hires
        .filter((h) => h.category)
        .map((h) => ({
          category: h.category,
          tokenId: h.tokenId,
          agentName: h.agentName,
          txHash: h.txHash,
        })),
      listings: v.listings ?? [],
      completedJobs: jobs
        .filter((j) => j.status === "Completed")
        .map((j) => ({
          jobId: j.id,
          agentName: j.agentName,
          tokenId: j.tokenId,
          completedAt: j.updatedAt,
          deliverable: j.deliverable ?? null,
        })),
    });
  }

  completed.sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));

  return NextResponse.json({
    success: true,
    count: completed.length,
    candidates: candidates.length,
    considered: possible.length,
    completed,
    // an answer from memory is a floor rather than the truth, the same caveat the
    // per wallet route carries
    source,
    incomplete: source === "memory",
  });
}
