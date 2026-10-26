import { NextRequest, NextResponse } from "next/server";
import { receiptById } from "@/lib/receipt-store";

export const dynamic = "force-dynamic";

type Check = { name: string; holds: boolean; detail: string };

interface Verdict {
  basis: "trigger gate";
  expectedAction: "trade" | "hold" | "refuse" | "stop" | "unknown";
  triggerHolds: boolean;
  checks: Check[];
  notReplayed: string[];
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

function band(t: Record<string, unknown>, kill: boolean): Verdict {
  const drift = num(t.drift);
  const min = num(t.minDriftPct);
  const width = num(t.widthPct);
  const known = drift != null && min != null;
  const outside = known && Math.abs(drift!) >= min!;
  return {
    basis: "trigger gate",
    expectedAction: kill ? "stop" : outside ? "trade" : "hold",
    triggerHolds: !kill && outside,
    checks: [
      { name: "drift was measured", holds: drift != null, detail: drift == null ? "no drift in the receipt" : `drift ${drift}%` },
      { name: "drift clears the minimum", holds: outside, detail: min == null ? "no minimum stored" : `min ${min}%` },
      { name: "band width recorded", holds: width != null, detail: width == null ? "not stored" : `width ${width}%` },
    ],
    notReplayed: ["cost ratio", "slippage", "amount sizing"],
  };
}

function buffer(t: Record<string, unknown>, kill: boolean): Verdict {
  const liquid = num(t.liquid);
  const total = num(t.totalSleeve);
  const minPct = num(t.minBufferPct);
  const venueYield = num(t.venueYield);
  const minYield = num(t.minYieldPct);
  const floor = liquid != null && total != null && minPct != null ? total * minPct : null;
  const breached = floor != null && liquid != null && liquid < floor;
  const surplus = floor != null && liquid != null && liquid > floor;
  const yieldOk = venueYield != null && minYield != null && venueYield >= minYield;
  const trade = breached || (surplus && yieldOk);
  return {
    basis: "trigger gate",
    expectedAction: kill ? "stop" : trade ? "trade" : "hold",
    triggerHolds: !kill && trade,
    checks: [
      { name: "liquid floor respected", holds: floor != null && liquid != null && !breached, detail: floor == null ? "floor not derivable" : `liquid ${liquid}, floor ${floor}` },
      { name: "deployable surplus", holds: surplus, detail: surplus ? "surplus above the floor" : "no surplus above the floor" },
      { name: "yield clears the minimum", holds: yieldOk, detail: venueYield == null || minYield == null ? "yield not stored" : `${venueYield} vs ${minYield}` },
    ],
    notReplayed: ["venue exit latency", "slippage"],
  };
}

function porter(t: Record<string, unknown>, kill: boolean): Verdict {
  const hf = num(t.healthFactor);
  const defendAt = num(t.defendAt);
  const liquidatableAt = num(t.liquidatableAt);
  const age = num(t.priceAgeSec);
  const maxAge = num(t.maxPriceAgeSec);
  const stale = age != null && maxAge != null && age > maxAge;
  const liquidatable = hf != null && liquidatableAt != null && hf <= liquidatableAt;
  const defend = hf != null && defendAt != null && hf <= defendAt && !liquidatable;
  const expected = kill ? "stop" : stale || liquidatable ? "refuse" : defend ? "trade" : "hold";
  return {
    basis: "trigger gate",
    expectedAction: expected,
    triggerHolds: !kill && !stale && !liquidatable && defend,
    checks: [
      { name: "price is fresh", holds: !stale, detail: age == null || maxAge == null ? "age not stored" : `${age}s of ${maxAge}s` },
      { name: "above liquidation", holds: !liquidatable, detail: hf == null || liquidatableAt == null ? "hf not stored" : `hf ${hf} vs ${liquidatableAt}` },
      { name: "at or below the defend band", holds: defend, detail: defendAt == null ? "band not stored" : `defend at ${defendAt}` },
    ],
    notReplayed: ["slippage", "oracle source age"],
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "id required" }, { status: 400 });

  const receipt = await receiptById(id);
  if (!receipt) return NextResponse.json({ success: false, error: "receipt not found" }, { status: 404 });

  const trigger = (receipt.trigger ?? {}) as Record<string, unknown>;
  const guardrail = (receipt.guardrail ?? {}) as Record<string, unknown>;
  const kill = guardrail.kill === true;

  let verdict: Verdict;
  if (receipt.policy === "Band") verdict = band(trigger, kill);
  else if (receipt.policy === "Buffer-Vault") verdict = buffer(trigger, kill);
  else if (receipt.policy === "Porter") verdict = porter(trigger, kill);
  else verdict = { basis: "trigger gate", expectedAction: "unknown", triggerHolds: false, checks: [], notReplayed: ["no replay rule for this policy"] };

  const recorded = typeof guardrail.action === "string"
    ? guardrail.action
    : receipt.status === "traded" ? "trade" : receipt.status === "refused" ? "refuse" : "hold";
  const recordedAction = recorded === "defend" ? "trade" : recorded;

  return NextResponse.json({
    success: true,
    ok: true,
    receipt: {
      id: receipt.id,
      policy: receipt.policy,
      status: receipt.status,
      reason: receipt.reason,
      blockNumber: receipt.blockNumber,
      txHash: receipt.txHash,
      createdAt: receipt.createdAt,
    },
    replay: {
      ...verdict,
      recordedAction,
      matches: verdict.expectedAction !== "unknown" && verdict.expectedAction === recordedAction,
    },
  }, { headers: { "cache-control": "no-store" } });
}
