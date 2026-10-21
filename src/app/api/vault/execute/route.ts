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
  // the operator's secret runs it by hand; Vercel's cron secret lets the
  // scheduler run the same sweep without a second header mechanism
  const secrets = [process.env.VAULT_SECRET, process.env.CRON_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );
  // fails closed like the verifier: no configured secret means nothing may run here
  if (secrets.length === 0) {
    return NextResponse.json({ error: "the vault executor is not configured" }, { status: 503 });
  }
  if (!authHeader || !secrets.includes(authHeader.replace(/^Bearer\s+/i, ""))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let actor: VaultActor;
  try {
    actor = resolveActor(undefined, CHAIN_ID);
  } catch (e) {
    // no actor lane on this deployment is a configuration state, not a failed
    // sweep: the scheduler can skip it until the key or session is set
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 503 });
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
    // the address is public chain state; a page or an operator can check that
    // the sweep looked at the wallet it expected
    const actorAddress = await actor.address().catch(() => null);
    return NextResponse.json({
      success: true,
      mode: EXECUTE ? "execute" : "dry",
      chainId: CHAIN_ID,
      actorKind: actor.kind,
      actorAddress,
      executed: EXECUTE,
      reports,
      traded: traded.length,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
