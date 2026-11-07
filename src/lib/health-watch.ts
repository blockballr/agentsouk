import "server-only";

import { randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { planDefence, rankPositions, readMandate, repayPosition } from "./health-operator";
import { defaultLeaseStore, type LeaseStore } from "./lease-store";
import { targetChainId } from "./types";

// The standing watch. Every run it walks the operator's active mandates, checks
// each portfolio, repays the worst position when the buyer's trigger is crossed,
// and draws the daily fee the buyer's subscription earned. No job is needed for
// the agent to look; the funded window only settles the result.

export interface WatchOutcome {
  buyer: Address;
  coverage: number | null;
  action: "repaid" | "none" | "skipped";
  amount?: string;
  txHash?: string;
  charged?: string;
  reason?: string;
}

export interface WatchRun {
  chainId: number;
  buyers: number;
  outcomes: WatchOutcome[];
}

const RPC = "https://bsc-dataseed.bnbchain.org";
const DAY = 86_400;

const SUBSCRIPTION_ABI = [
  {
    name: "planOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "buyer", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "agent", type: "address" },
          { name: "dailyRate", type: "uint128" },
          { name: "expiry", type: "uint64" },
          { name: "lastCharge", type: "uint64" },
        ],
      },
    ],
  },
  { name: "accrued", type: "function", stateMutability: "view", inputs: [{ name: "buyer", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "charge", type: "function", stateMutability: "nonpayable", inputs: [{ name: "buyer", type: "address" }], outputs: [] },
] as const;

const OPERATOR_ABI = [
  { name: "activeBuyers", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
] as const;

function publicClient() {
  return createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 20_000 }) });
}

// one charge a day per buyer: the rate accrues by the second, but a draw every
// five minutes would spend the fee on gas
async function chargeIfDue(
  subscription: Address,
  buyer: Address,
  agent: Address,
  agentKey: `0x${string}`,
  nowSec: number,
): Promise<string | null> {
  const client = publicClient();
  const plan = (await client.readContract({
    address: subscription,
    abi: SUBSCRIPTION_ABI,
    functionName: "planOf",
    args: [buyer],
  })) as { agent: Address; dailyRate: bigint; expiry: number | bigint; lastCharge: number | bigint };

  if (plan.agent.toLowerCase() !== agent.toLowerCase()) return null;
  if (Number(plan.expiry) <= nowSec) return null;
  if (nowSec - Number(plan.lastCharge) < DAY) return null;

  const accrued = await client.readContract({
    address: subscription,
    abi: SUBSCRIPTION_ABI,
    functionName: "accrued",
    args: [buyer],
  });
  if (accrued === 0n) return null;

  const account = privateKeyToAccount(agentKey);
  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC, { timeout: 20_000 }) });
  const hash = await wallet.writeContract({
    address: subscription,
    abi: SUBSCRIPTION_ABI,
    functionName: "charge",
    args: [buyer],
  });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`the charge transaction ${hash} reverted`);
  return hash;
}

export async function watchMandates(options: {
  operator: Address;
  subscription?: Address;
  agentKey: `0x${string}`;
  limit?: number;
  budgetMs?: number;
  lease?: LeaseStore;
}): Promise<WatchRun> {
  const chainId = targetChainId();
  const agent = privateKeyToAccount(options.agentKey);
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const budgetMs = options.budgetMs ?? 120_000;
  const startedAt = Date.now();
  const client = publicClient();
  const lease = options.lease ?? defaultLeaseStore();
  const runId = randomUUID();
  // longer than the route's five minute ceiling, short enough that a crashed
  // run delays the next check by one interval rather than a day
  const leaseMs = 5 * 60_000;

  const buyers = (await client.readContract({
    address: options.operator,
    abi: OPERATOR_ABI,
    functionName: "activeBuyers",
  })) as readonly Address[];

  const outcomes: WatchOutcome[] = [];
  for (const buyer of buyers.slice(0, limit)) {
    if (Date.now() - startedAt > budgetMs) break;
    const key = buyer.toLowerCase();
    const holder = `${runId}:${key}`;
    if (!(await lease.acquire(key, holder, leaseMs))) {
      outcomes.push({ buyer, coverage: null, action: "skipped", reason: "another watcher holds this buyer" });
      continue;
    }
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      try {
        const mandate = await readMandate(options.operator, buyer);
        if (!mandate) {
          outcomes.push({ buyer, coverage: null, action: "skipped", reason: "no live mandate" });
          continue;
        }
        if (mandate.expiry <= nowSec) {
          outcomes.push({ buyer, coverage: null, action: "skipped", reason: "the mandate has expired" });
          continue;
        }
        if (mandate.agent.toLowerCase() !== agent.address.toLowerCase()) {
          outcomes.push({ buyer, coverage: null, action: "skipped", reason: `the mandate names ${mandate.agent}` });
          continue;
        }

        const ranked = await rankPositions(chainId, mandate.positions);
        const plan = planDefence(ranked, mandate.trigger, mandate.target, mandate.maxRepayPerCall);
        if (!plan) {
          const coverage = ranked.length > 0 ? Math.min(...ranked.map((p) => p.healthFactor)) : null;
          outcomes.push({ buyer, coverage, action: "none" });
        } else {
          const txHash = await repayPosition(options.operator, buyer, plan.position.index, plan.amount, options.agentKey);
          const after = await rankPositions(chainId, [mandate.positions[plan.position.index]]);
          outcomes.push({
            buyer,
            coverage: plan.position.healthFactor,
            action: "repaid",
            amount: plan.amount.toString(),
            txHash,
            reason: `coverage ${plan.position.healthFactor.toFixed(3)} -> ${(after[0]?.healthFactor ?? 0).toFixed(3)}`,
          });
        }

        if (options.subscription) {
          const charged = await chargeIfDue(options.subscription, buyer, agent.address, options.agentKey, nowSec).catch(() => null);
          if (charged) outcomes[outcomes.length - 1].charged = charged;
        }
      } catch (error) {
        outcomes.push({ buyer, coverage: null, action: "skipped", reason: (error as Error).message.slice(0, 160) });
      }
    } finally {
      await lease.release(key, holder);
    }
  }

  return { chainId, buyers: buyers.length, outcomes };
}
