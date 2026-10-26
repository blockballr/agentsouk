import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import {
  addRating,
  ratingMessage,
  ratingsFor,
  ratingSummary,
  verifyRatingSignature,
  type Rating,
} from "@/lib/ratings";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/ratings?chainId=56&tokenId=123  -> ratings + summary for an agent
export async function GET(req: NextRequest): Promise<NextResponse> {
  const chainId = Number(req.nextUrl.searchParams.get("chainId")) || targetChainId();
  const tokenId = req.nextUrl.searchParams.get("tokenId") ?? "";
  if (!/^\d{1,78}$/.test(tokenId)) {
    return json({ success: false, error: "tokenId required" }, 400);
  }
  const list = ratingsFor(chainId, tokenId);
  const summary = ratingSummary(chainId, tokenId);
  return json({ success: true, ok: true, chainId, tokenId, ratings: list, summary });
}

// POST /api/ratings  {chainId, tokenId, paymentId, score, comment, verifierScore, rater, signature}
// The buyer signs ratingMessage(...) with their wallet; the route verifies the
// signature before storing, and one rating per paymentId is enforced.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ success: false, error: "body required" }, 400);

  const chainId = body.chainId === undefined ? targetChainId() : Number(body.chainId);
  if (!Number.isSafeInteger(chainId) || chainId < 1) return json({ success: false, error: "chainId invalid" }, 400);

  const tokenId = typeof body.tokenId === "string" || typeof body.tokenId === "number" ? String(body.tokenId) : "";
  if (!/^\d{1,78}$/.test(tokenId)) return json({ success: false, error: "tokenId required" }, 400);

  const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
  if (!paymentId) return json({ success: false, error: "paymentId required" }, 400);

  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) return json({ success: false, error: "score must be 1..5" }, 400);

  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 500) : "";
  const verifierScore = Number(body.verifierScore);
  if (!Number.isFinite(verifierScore) || verifierScore < 0 || verifierScore > 100) {
    return json({ success: false, error: "verifierScore must be 0..100" }, 400);
  }

  const rater = typeof body.rater === "string" ? body.rater.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(rater)) return json({ success: false, error: "rater must be a wallet" }, 400);

  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return json({ success: false, error: "signature required" }, 400);

  const ok = await verifyRatingSignature({ chainId, tokenId, paymentId, score, comment, verifierScore, rater, signature });
  if (!ok) return json({ success: false, error: "signature did not verify" }, 401);

  const rating: Rating = {
    id: `${chainId}:${tokenId}:${paymentId}`,
    chainId,
    tokenId,
    paymentId,
    rater: getAddress(rater).toLowerCase(),
    score,
    comment,
    verifierScore,
    createdAt: new Date().toISOString(),
  };
  try {
    addRating(rating);
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 409);
  }
  return json({ success: true, ok: true, rating, summary: ratingSummary(chainId, tokenId) }, 201);
}
