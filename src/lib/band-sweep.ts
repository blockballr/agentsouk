import "server-only";
import { randomUUID } from "node:crypto";
import type { PublicClient } from "viem";
import { pancakeToken } from "./pancake";
import { vaultFor, VAULT_READ_ABI, tradeCallFor, type HireView } from "./vault";
import { bandPolicyFromEnv, decideBand, initialBandState, type BandHireFacts } from "./band-policy";
import { acquireLease, getStrategyState, releaseLease } from "./strategy-store";
import { writeReceipt } from "./receipt-store";
import { hireValue0 } from "./vault-value";
import { getHirePolicy } from "./policy-registry";
import type { VaultActor } from "./vault-actor";

export interface BandTradeReport {
  id: string;
  buyer: string;
  status: "traded" | "skipped" | "refused";
  reason: string | null;
  txHash: string | null;
  weightA: number | null;
  drift: number | null;
}

export async function sweepBandHires(
  client: PublicClient,
  chainId: number,
  actor: VaultActor,
  limit: number,
  outOfTime: () => boolean,
  execute: boolean,
): Promise<BandTradeReport[]> {
  const agent = await actor.address();
  const vault = vaultFor(chainId);
  const tokenA = pancakeToken(chainId, "WBNB");
  const tokenB = pancakeToken(chainId, "USDT");
  if (!tokenA || !tokenB) throw new Error(`the bound pair is not configured on chain ${chainId}`);
  if (!vault) throw new Error(`no vault deployed on chain ${chainId}`);
  const policy = bandPolicyFromEnv(process.env);
  const kill = process.env.VAULT_KILL === "1";
  const holder = `${agent}:${randomUUID()}`;
  const { agentHireIds, readHire } = await import("./vault-executor");
  const ids = await agentHireIds(client, chainId, agent);
  const reports: BandTradeReport[] = [];
  const nowSec = () => Math.floor(Date.now() / 1000);

  for (const id of ids.slice(0, limit)) {
    if (outOfTime()) break;
    const lease = await acquireLease(chainId, id.toString(), holder, 25 * 60 * 1000);
    if (!lease) {
      reports.push({ id: id.toString(), buyer: "", status: "skipped", reason: "another runner holds the lease", txHash: null, weightA: null, drift: null });
      continue;
    }
    try {
      const hire = await readHire(client, chainId, id);
      const value0 = await hireValue0(client, vault, id);
      const row = { id: id.toString(), buyer: hire.buyer };
      const tagged = await getHirePolicy(chainId, id.toString());
      if (tagged !== "band") {
        reports.push({ ...row, status: "skipped", reason: tagged ? `hire tagged for ${tagged}, not band` : "hire has no policy tag", txHash: null, weightA: null, drift: null });
        continue;
      }
      if (!hire.open || nowSec() >= hire.expiry) {
        reports.push({ ...row, status: "skipped", reason: hire.open ? "expired" : "not open", txHash: null, weightA: null, drift: null });
        continue;
      }
      const quote = await (await import("./pancake-read")).readPancakePrice(chainId, tokenA.symbol, tokenB.symbol, { feeTier: hire.fee });
      if ("error" in quote) {
        reports.push({ ...row, status: "skipped", reason: `no price mark: ${quote.error}`, txHash: null, weightA: null, drift: null });
        continue;
      }
      const refPrice = quote.price;
      const facts: BandHireFacts = {
        id: hire.id,
        open: hire.open,
        expiry: hire.expiry,
        balanceA: hire.balanceA,
        balanceB: hire.balanceB,
        refPriceX96: hire.refPriceX96,
        targetWeightA: 50, // default 50/50 target
        maxSlippageBps: hire.maxSlippageBps,
      };
      const state = await getStrategyState(chainId, id.toString());
      const bandState = state ? { generation: state.generation, lastBlock: state.lastBlock, lastWeightA: 50, acted: state.crossed } : null;
      const outcome = decideBand({
        hire: facts,
        policy,
        state: bandState,
        price: refPrice,
        blockNumber: BigInt(quote.blockNumber),
        nowSec: nowSec(),
        kill,
      });

      const weightA = "weightA" in outcome ? outcome.weightA : null;
      const drift = "drift" in outcome ? outcome.drift : null;
      const trigger = {
        refPrice,
        quoteBlock: quote.blockNumber,
        weightA,
        drift,
        targetWeightA: 50,
        widthPct: policy.widthPct,
        minDriftPct: policy.minDriftPct,
      };
      const guardrail = {
        allowed: outcome.action === "trade",
        action: outcome.action,
        reason: outcome.reason,
        kill,
        maxCostRatio: policy.maxCostRatio,
      };
      const intents = outcome.action === "trade" ? outcome.intents : [];
      const simulation = {
        wouldTrade: intents.length > 0,
        intents: intents.map((i) => ({ side: i.side, tokenInSide: i.tokenInSide, amountIn: i.amountIn.toString(), reason: i.reason })),
      };
      const afterState = async () => {
        const post = await readHire(client, chainId, id);
        const postWeight = (Number(post.balanceA) * refPrice) / ((Number(post.balanceA) * refPrice) + Number(post.balanceB) || 1) * 100;
        return { balanceA: post.balanceA.toString(), balanceB: post.balanceB.toString(), refPrice, weightA: postWeight, value0: (await hireValue0(client, vault, id))?.toString() ?? null };
      };

      if (outcome.action !== "trade" || outcome.intents.length === 0) {
        reports.push({ ...row, status: "skipped", reason: outcome.reason, txHash: null, weightA, drift });
        await writeReceipt({ chainId, hireId: id.toString(), agent, status: "skipped", reason: outcome.reason, txHash: null, blockNumber: quote.blockNumber, before: { weightA, drift, value0: value0?.toString() ?? null }, after: null, trigger, guardrail, simulation, policy: "Band" });
        continue;
      }

      for (const intent of outcome.intents) {
        if (!execute) {
          reports.push({ ...row, status: "skipped", reason: `dry run: would ${intent.side} ${intent.amountIn} of token ${intent.tokenInSide}`, txHash: null, weightA, drift });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "skipped", reason: `dry run: ${intent.side}`, txHash: null, blockNumber: quote.blockNumber, before: { weightA, drift, value0: value0?.toString() ?? null }, after: null, trigger, guardrail: { ...guardrail, allowed: true, dryRun: true }, simulation, policy: "Band" });
          continue;
        }
        const data = tradeCallFor(id, intent.tokenInSide === "A" ? tokenA.address : tokenB.address, intent.amountIn);
        try {
          const txHash = await actor.trade({ to: vault as `0x${string}`, data });
          reports.push({ ...row, status: "traded", reason: null, txHash, weightA, drift });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "traded", reason: null, txHash, blockNumber: quote.blockNumber, before: { weightA, drift, value0: value0?.toString() ?? null }, after: await afterState(), trigger, guardrail, simulation, policy: "Band" });
        } catch (e) {
          reports.push({ ...row, status: "refused", reason: (e as Error).message.slice(0, 200), txHash: null, weightA, drift });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "refused", reason: (e as Error).message.slice(0, 200), txHash: null, blockNumber: quote.blockNumber, before: { weightA, drift, value0: value0?.toString() ?? null }, after: null, trigger, guardrail, simulation, policy: "Band" });
          break;
        }
      }
    } finally {
      await releaseLease(chainId, id.toString(), holder);
    }
  }
  return reports;
}
