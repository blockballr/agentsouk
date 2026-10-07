import { NextRequest, NextResponse } from "next/server";
import { escrowFunder, escrowStatuses } from "@/lib/escrow";

export const dynamic = "force-dynamic";

// GET /api/escrow?paymentIds=a,b,c
// The on-chain state of each settled hire's escrow: which payment is held,
// verified, released or refunded, and when the dispute window ends. Public
// chain state behind one read the hire cards can poll, so a card never calls a
// hire "paid" while the funder still holds the money. Without a funder in env
// the answer is simply nothing to show
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("paymentIds") ?? "";
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, 40);
  const funder = escrowFunder();
  if (!funder || ids.length === 0) {
    return NextResponse.json({ funder, jobs: [] });
  }
  const jobs = await escrowStatuses(ids);
  return NextResponse.json({ funder, jobs });
}
