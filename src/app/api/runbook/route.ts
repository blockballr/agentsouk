import { NextRequest, NextResponse } from "next/server";
import { buildRunbook, type RunbookDetail } from "@/lib/runbook";
import { RUNBOOK_INTENTS, isRunbookIntent } from "@/lib/runbook-intents";
import { policyForWallet } from "@/lib/agent-policy";
import { targetChainId } from "@/lib/types";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// A runbook reads the registry, so an unauthenticated caller is bounded before
// it does. One agent asks for a handful per session; the cap is far above that.
const LIMIT = { table: "runbook_rate_limits", limit: 300, windowMs: 60 * 60 * 1000 };

const NO_STORE = { "cache-control": "no-store" };

// GET /api/runbook?intent=hire&tokenId=391002&chainId=56
// The live plan for one intent, optionally tailored to one agent.
export async function GET(req: NextRequest): Promise<NextResponse> {
  let rate;
  try {
    rate = await enforceRateLimit(LIMIT, { keys: [`ip:${clientIpFrom(req.headers)}`] });
  } catch {
    return NextResponse.json({ error: "Runbooks are temporarily unavailable, please try again shortly." }, { status: 503 });
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many runbook requests. Try again later." },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) } },
    );
  }

  const requested = req.nextUrl.searchParams.get("intent") ?? "browse";
  if (!isRunbookIntent(requested)) {
    return NextResponse.json(
      { error: `intent must be one of: ${RUNBOOK_INTENTS.join(", ")}` },
      { status: 400 },
    );
  }

  const askedChain = Number(req.nextUrl.searchParams.get("chainId"));
  const chainId = Number.isSafeInteger(askedChain) && askedChain > 0 ? askedChain : targetChainId();
  const tokenId = (req.nextUrl.searchParams.get("tokenId") ?? "").trim();
  if (tokenId && !/^\d{1,78}$/.test(tokenId)) {
    return NextResponse.json({ error: "tokenId must be a token id" }, { status: 400 });
  }

  let detail: RunbookDetail | null = null;
  if (tokenId) {
    try {
      const url = new URL(`/api/agents/${chainId}/${tokenId}`, req.nextUrl.origin);
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) {
        return NextResponse.json({ error: `no agent ${tokenId} on chain ${chainId}` }, { status: 404 });
      }
      if (res.ok) {
        const body = (await res.json()) as { data?: RunbookDetail };
        detail = body?.data ?? null;
      }
    } catch {
      // a slow registry still gets a plan without the agent section
      detail = null;
    }
  }

  const wallet = detail?.agent_wallet ?? detail?.owner_address ?? "";
  const firstParty = wallet ? policyForWallet(chainId, wallet) : null;
  const runbook = buildRunbook({ intent: requested, chainId, detail, firstParty });
  return NextResponse.json(runbook, { headers: NO_STORE });
}
