import "server-only";
import { randomUUID } from "node:crypto";
import type { PublicClient } from "viem";
import { pancakeToken } from "./pancake";
import { vaultFor, VAULT_READ_ABI, tradeCallFor, type HireView } from "./vault";
import { porterPolicyFromEnv, decidePorter, initialPorterState, type PorterHireFacts } from "./porter-policy";
import { acquireLease, getStrategyState, releaseLease, saveStrategyState } from "./strategy-store";
import { writeReceipt } from "./receipt-store";
import { hireValue0 } from "./vault-value";
import { getHirePolicy } from "./policy-registry";
import type { VaultActor } from "./vault-actor";

export interface PorterTradeReport {
  id: string;
  buyer: string;
  status: "traded" | "skipped" | "refused";
  reason: string | null;
  txHash: string | null;
  healthFactor: number | null;
  band: string | null;
}

export async function sweepPorterHires(
  client: PublicClient,
  chainId: number,
  actor: VaultActor,
  limit: number,
  outOfTime: () => boolean,
  execute: boolean,
): Promise<PorterTradeReport[]> {
  const agent = await actor.address();
  const vault = vaultFor(chainId);
  if (!vault) throw new Error(`no vault deployed on chain ${chainId}`);
  const policy = porterPolicyFromEnv(process.env);
  const kill = process.env.VAULT_KILL === "1";
  const holder = `${agent}:${randomUUID()}`;
  const ids = await (await import("./vault-executor")).agentHireIds(client, chainId, agent);
  const reports: PorterTradeReport[] = [];
  const nowSec = () => Math.floor(Date.now() / 1000);
  let head = 0;
  let headTime = 0;
  try {
    const block = await client.getBlock({ blockTag: "latest" });
    head = Number(block.number);
    headTime = Number(block.timestamp);
  } catch { head = 0; }

  for (const id of ids.slice(0, limit)) {
    if (outOfTime()) break;
    const lease = await acquireLease(chainId, id.toString(), holder, 25 * 60 * 1000);
    if (!lease) {
      reports.push({ id: id.toString(), buyer: "", status: "skipped", reason: "another runner holds the lease", txHash: null, healthFactor: null, band: null });
      continue;
    }
    try {
      const hire = await (await import("./vault-executor")).readHire(client, chainId, id);
      const value0 = await hireValue0(client, vault, id);
      const row = { id: id.toString(), buyer: hire.buyer };
      const tagged = await getHirePolicy(chainId, id.toString());
      if (tagged !== "porter") {
        reports.push({ ...row, status: "skipped", reason: tagged ? `hire tagged for ${tagged}, not porter` : "hire has no policy tag", txHash: null, healthFactor: null, band: null });
        continue;
      }
      if (!hire.open || nowSec() >= hire.expiry) {
        reports.push({ ...row, status: "skipped", reason: hire.open ? "expired" : "not open", txHash: null, healthFactor: null, band: null });
        continue;
      }
      const refPrice = hire.refPriceX96 > 0n ? Number(hire.refPriceX96) / 1e18 : 1;
      const collateralValue = hire.balanceA;
      const debtValue = hire.balanceB;
      const liquidationThreshold = BigInt(Math.floor(policy.liquidatableAt * 1e18));
      const priceAgeSec = headTime > 0 ? Math.max(0, nowSec() - headTime) : 0;
      const maxPriceAgeSec = Number(process.env.PORTER_MAX_PRICE_AGE_SEC ?? "") || 300;
      const facts: PorterHireFacts = {
        id: hire.id,
        open: hire.open,
        expiry: hire.expiry,
        collateralValue,
        debtValue,
        liquidationThreshold,
        priceAgeSec,
        maxPriceAgeSec,
        maxSlippageBps: hire.maxSlippageBps,
      };
      const outcome = decidePorter({
        hire: facts,
        policy,
        state: await getStrategyState(chainId, id.toString()).then((s) => s ? { generation: s.generation, lastBlock: s.lastBlock, lastHealthFactor: 0, acted: s.crossed } : null),
        blockNumber: BigInt(head),
        nowSec: nowSec(),
        kill,
      });
      const hf = "healthFactor" in outcome ? outcome.healthFactor : null;
      const trigger = {
        blockNumber: head,
        blockTime: headTime > 0 ? new Date(headTime * 1000).toISOString() : null,
        refPrice,
        collateral: collateralValue.toString(),
        debt: debtValue.toString(),
        healthFactor: hf,
        defendAt: policy.defendAt,
        targetHf: policy.targetHf,
        priceAgeSec,
        maxPriceAgeSec,
      };
      const guardrail = {
        allowed: outcome.action === "defend",
        action: outcome.action,
        reason: outcome.reason,
        kill,
        liquidatableAt: policy.liquidatableAt,
      };
      const intents = outcome.action === "defend" ? outcome.intents : [];
      const simulation = {
        wouldDefend: intents.length > 0,
        intents: intents.map((i) => ({ band: i.band, tokenInSide: i.tokenInSide, amountIn: i.amountIn.toString() })),
      };
      const afterState = async () => {
        const post = await (await import("./vault-executor")).readHire(client, chainId, id);
        const postHf = post.balanceB === 0n ? null : Number((post.balanceA * liquidationThreshold) / post.balanceB) / 1e18;
        return { collateral: post.balanceA.toString(), debt: post.balanceB.toString(), healthFactor: postHf, value0: (await hireValue0(client, vault, id))?.toString() ?? null };
      };

      if (outcome.action === "refuse") {
        reports.push({ ...row, status: "refused", reason: outcome.reason, txHash: null, healthFactor: hf, band: null });
        await writeReceipt({ chainId, hireId: id.toString(), agent, status: "refused", reason: outcome.reason, txHash: null, blockNumber: head, before: { healthFactor: hf, value0: value0?.toString() ?? null }, after: null, trigger, guardrail, simulation, policy: "Porter" });
        continue;
      }
      if (outcome.action !== "defend" || outcome.intents.length === 0) {
        reports.push({ ...row, status: "skipped", reason: outcome.reason, txHash: null, healthFactor: hf, band: null });
        await writeReceipt({ chainId, hireId: id.toString(), agent, status: "skipped", reason: outcome.reason, txHash: null, blockNumber: head, before: { healthFactor: hf, value0: value0?.toString() ?? null }, after: null, trigger, guardrail, simulation, policy: "Porter" });
        continue;
      }

      for (const intent of outcome.intents) {
        if (!execute) {
          reports.push({ ...row, status: "skipped", reason: `dry run: would defend with ${intent.amountIn} of token ${intent.tokenInSide}`, txHash: null, healthFactor: hf, band: intent.band });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "skipped", reason: `dry run: ${intent.band}`, txHash: null, blockNumber: head, before: { healthFactor: hf, value0: value0?.toString() ?? null }, after: null, trigger, guardrail: { ...guardrail, allowed: true, dryRun: true }, simulation, policy: "Porter" });
          continue;
        }
        const data = tradeCallFor(id, intent.tokenInSide === "A" ? (await import("./pancake")).pancakeToken(chainId, "WBNB")!.address : (await import("./pancake")).pancakeToken(chainId, "USDT")!.address, intent.amountIn);
        try {
          const txHash = await actor.trade({ to: vault as `0x${string}`, data });
          reports.push({ ...row, status: "traded", reason: null, txHash, healthFactor: hf, band: intent.band });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "traded", reason: null, txHash, blockNumber: head, before: { healthFactor: hf, value0: value0?.toString() ?? null }, after: await afterState(), trigger, guardrail, simulation, policy: "Porter" });
        } catch (e) {
          reports.push({ ...row, status: "refused", reason: (e as Error).message.slice(0, 200), txHash: null, healthFactor: hf, band: intent.band });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "refused", reason: (e as Error).message.slice(0, 200), txHash: null, blockNumber: head, before: { healthFactor: hf, value0: value0?.toString() ?? null }, after: null, trigger, guardrail, simulation, policy: "Porter" });
          break;
        }
      }
    } finally {
      await releaseLease(chainId, id.toString(), holder);
    }
  }
  return reports;
}
