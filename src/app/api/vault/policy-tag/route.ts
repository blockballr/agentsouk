import { NextRequest, NextResponse } from "next/server";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";
import { setHirePolicy, getHirePolicy, listHirePolicies } from "@/lib/policy-registry";

export const dynamic = "force-dynamic";

const CHAIN_ID = targetChainId();

// operator-only: tag a hire with a policy so the unified sweep knows which
// strategy to run on it. A hire with no tag is skipped by every sweep until
// it is tagged, so an untagged deposit cannot be traded twice.
export async function GET(req: NextRequest) {
  const policies = await listHirePolicies(CHAIN_ID);
  return NextResponse.json({ chainId: CHAIN_ID, policies });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.VAULT_SECRET;
  if (!secret || !authHeader || authHeader.replace(/^Bearer\s+/i, "") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { hireId?: string; policy?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const hireId = String(body.hireId ?? "").trim();
  const policy = String(body.policy ?? "").trim().toLowerCase();
  if (!hireId) return NextResponse.json({ error: "hireId required" }, { status: 400 });
  if (!["porter", "band", "buffer", "grid"].includes(policy)) {
    return NextResponse.json({ error: "policy must be porter, band, buffer, or grid" }, { status: 400 });
  }
  await setHirePolicy(CHAIN_ID, hireId, policy);
  return NextResponse.json({ chainId: CHAIN_ID, hireId, policy });
}
