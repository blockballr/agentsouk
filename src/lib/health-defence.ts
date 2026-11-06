import "server-only";

import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { planDefence, rankPositions, readMandate, repayPosition } from "./health-operator";
import { targetChainId } from "./types";

// The funded defence: a buyer writes a mandate, hires the agent through an
// ERC-8183 job, and the agent defends the worst position inside that mandate.
// The deliverable carries the transaction, so the fee settles against a move
// that anyone can check.

export interface DefenceRequest {
  buyer: Address;
  operator: Address;
}

export interface DefenceProof {
  action: "repay" | "none";
  chainId: number;
  operator: Address;
  buyer: Address;
  positionIndex: number | null;
  account: Address | null;
  amount: string;
  txHash: string | null;
  coverageBefore: number | null;
  coverageAfter: number | null;
  debtUsd: number | null;
  reason?: string;
}

const ADDRESS = "0x[0-9a-fA-F]{40}";

// a defence job names the buyer and, optionally, the operator. the operator may
// come from the deployment so a buyer does not have to repeat it in the task.
export function parseDefenceTask(task: string, defaultOperator?: Address): DefenceRequest | null {
  if (!/\bdefend\b/i.test(task)) return null;
  const buyer = new RegExp(`buyer[:\\s]+(${ADDRESS})`, "i").exec(task)?.[1];
  if (!buyer) return null;
  const named = new RegExp(`operator[:\\s]+(${ADDRESS})`, "i").exec(task)?.[1];
  const operator = named ?? defaultOperator;
  if (!operator) return null;
  return { buyer: buyer as Address, operator: operator as Address };
}

export async function runHealthDefence(
  request: DefenceRequest,
  options: { agentKey: `0x${string}`; target?: number },
): Promise<DefenceProof> {
  const chainId = targetChainId();
  const agent = privateKeyToAccount(options.agentKey);
  const base: DefenceProof = {
    action: "none",
    chainId,
    operator: request.operator,
    buyer: request.buyer,
    positionIndex: null,
    account: null,
    amount: "0",
    txHash: null,
    coverageBefore: null,
    coverageAfter: null,
    debtUsd: null,
  };

  const mandate = await readMandate(request.operator, request.buyer);
  if (!mandate) return { ...base, reason: "the buyer has no live mandate" };
  if (mandate.agent.toLowerCase() !== agent.address.toLowerCase()) {
    return { ...base, reason: `the mandate names ${mandate.agent}, not this agent` };
  }
  if (mandate.expiry <= Math.floor(Date.now() / 1000)) {
    return { ...base, reason: "the mandate has expired" };
  }

  const ranked = await rankPositions(chainId, mandate.positions);
  const plan = planDefence(ranked, mandate.trigger, mandate.target, mandate.maxRepayPerCall);
  if (!plan) {
    const worst = ranked.length > 0 ? ranked.reduce((a, b) => (a.healthFactor <= b.healthFactor ? a : b)) : null;
    return {
      ...base,
      positionIndex: worst?.index ?? null,
      account: worst?.account ?? null,
      coverageBefore: worst?.healthFactor ?? null,
      coverageAfter: worst?.healthFactor ?? null,
      debtUsd: worst?.debtUsd ?? null,
      reason: worst
        ? `coverage ${worst.healthFactor.toFixed(3)} is above the ${mandate.trigger} trigger`
        : "the mandate carries no readable position",
    };
  }
  const worst = plan.position;
  const amount = plan.amount;

  const txHash = await repayPosition(request.operator, request.buyer, worst.index, amount, options.agentKey);
  const after = await rankPositions(chainId, [mandate.positions[worst.index]]);
  const coverageAfter = after[0]?.healthFactor ?? null;

  return {
    action: "repay",
    chainId,
    operator: request.operator,
    buyer: request.buyer,
    positionIndex: worst.index,
    account: worst.account,
    amount: amount.toString(),
    txHash,
    coverageBefore: worst.healthFactor,
    coverageAfter,
    debtUsd: worst.debtUsd,
  };
}
