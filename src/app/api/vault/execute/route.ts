import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { loggedCronRun } from "@/lib/history-store";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";
import { rpcTransport } from "@/lib/rpc";
import { sweepOwnHires } from "@/lib/vault-executor";
import { sweepBandHires } from "@/lib/band-sweep";
import { sweepBufferVault } from "@/lib/buffer-sweep";
import { resolveActors, type VaultActor } from "@/lib/vault-actor";

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

  let actors: VaultActor[];
  try {
    actors = resolveActors(undefined, CHAIN_ID);
  } catch (e) {
    // no actor lane on this deployment is a configuration state, not a failed
    // sweep: the scheduler can skip it until the key or session is set
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 503 });
  }

  const policy = req.nextUrl.searchParams.get("policy") ?? "grid";
  // porter is not a separate runner: the venue guard runs inside the buffer
  // sweep, because only the hire's named agent can pull its position. a caller
  // that asks for it by name is pointed at the lane that owns it.
  if (policy === "porter") {
    return NextResponse.json(
      {
        success: false,
        error: "porter runs inside the buffer sweep; call policy=buffer",
      },
      { status: 400 },
    );
  }

  try {
    const client = createPublicClient({ chain: CHAIN_ID === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc, transport: rpcTransport(CHAIN_ID) });
    const allReports: any[] = [];
    const actorAddresses: string[] = [];
    const actorKinds = new Set<string>();
    for (const actor of actors) {
      const { outOfTime } = sweepBudget();
      try {
        let reports: any[];
        if (policy === "all") {
          const r2 = await sweepBandHires(client, CHAIN_ID, actor, LIMIT, outOfTime, EXECUTE);
          const r3 = await sweepBufferVault(client, CHAIN_ID, actor, LIMIT, outOfTime, EXECUTE);
          const r4 = await sweepOwnHires(client, CHAIN_ID, actor, LIMIT, outOfTime, EXECUTE);
          reports = [...r2, ...r3, ...r4];
        } else if (policy === "band") {
          reports = await sweepBandHires(client, CHAIN_ID, actor, LIMIT, outOfTime, EXECUTE);
        } else if (policy === "buffer") {
          reports = await sweepBufferVault(client, CHAIN_ID, actor, LIMIT, outOfTime, EXECUTE);
        } else {
          reports = await sweepOwnHires(client, CHAIN_ID, actor, LIMIT, outOfTime, EXECUTE);
        }
        allReports.push(...reports);
        const addr = await actor.address().catch(() => null);
        if (addr) actorAddresses.push(addr);
        actorKinds.add(actor.kind);
      } catch (e) {
        allReports.push({ status: "refused", reason: (e as Error).message.slice(0, 200), txHash: null });
      }
    }
    const traded = allReports.filter((r) => r.status === "traded");
    return NextResponse.json({
      success: true,
      mode: EXECUTE ? "execute" : "dry",
      chainId: CHAIN_ID,
      actorKind: actorKinds.size === 1 ? [...actorKinds][0] : "mixed",
      actorAddress: actorAddresses.length === 1 ? actorAddresses[0] : actorAddresses,
      actorCount: actors.length,
      executed: EXECUTE,
      reports: allReports,
      traded: traded.length,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
