import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { loggedCronRun } from "@/lib/history-store";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";
import { rpcTransport } from "@/lib/rpc";
import { sweepOwnHires } from "@/lib/vault-executor";
import { resolveActor, type VaultActor } from "@/lib/vault-actor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHAIN_ID = targetChainId();
// the executor waits for the operator's flag: an unset flag makes every run a
// report of what it would trade, never a transaction
const EXECUTE = process.env.VAULT_EXECUTE === "1";
const LIMIT = Math.max(1, Math.min(20, Number(process.env.VAULT_LIMIT ?? 5) || 5));
const BUDGET_MS = 200_000;

export function sweepBudget() {
  const startedAt = Date.now();
  return { startedAt, outOfTime: () => Date.now() - startedAt > BUDGET_MS };
}

export function GET(req: NextRequest) {
  return loggedCronRun("vault-execute", () => run(req));
}

export function POST(req: NextRequest) {
  return loggedCronRun("vault-execute", () => run(req));
}

async function run(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.VAULT_SECRET;
  // fails closed like the verifier: an unset secret has nothing configured here
  if (!secret) {
    return NextResponse.json({ error: "the vault executor is not configured" }, { status: 503 });
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let actor: VaultActor;
  try {
    actor = resolveActor();
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }

  try {
    const { outOfTime } = sweepBudget();
    // the sweep always computes; the report labels every trade the flag would
    // or did send, so a dry run is a full rehearsal, not a truncated stub
    const reports = await sweepOwnHires(
      createPublicClient({ chain: CHAIN_ID === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc, transport: rpcTransport(CHAIN_ID) }),
      CHAIN_ID,
      actor,
      LIMIT,
      outOfTime,
      EXECUTE,
    );
    const traded = reports.filter((r) => r.status === "traded");
    return NextResponse.json({
      success: true,
      mode: EXECUTE ? "execute" : "dry",
      chainId: CHAIN_ID,
      actorKind: actor.kind,
      executed: EXECUTE,
      reports,
      traded: traded.length,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
