import "server-only";

import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// The buyer's mandate lives in the operator contract, never here. This module
// only reads it, ranks the positions, and makes the one call the mandate allows.

export interface MandatePosition {
  account: Address;
  vTokenDebt: Address;
}

export interface Mandate {
  agent: Address;
  asset: Address;
  maxRepayPerCall: bigint;
  maxRepayPerDay: bigint;
  expiry: number;
  active: boolean;
  positions: MandatePosition[];
}

export interface RankedPosition extends MandatePosition {
  index: number;
  // the health factor as a decimal, higher is safer
  healthFactor: number;
}

const MANDATE_ABI = [
  {
    name: "mandateOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "buyer", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "agent", type: "address" },
          { name: "asset", type: "address" },
          { name: "maxRepayPerCall", type: "uint128" },
          { name: "maxRepayPerDay", type: "uint128" },
          { name: "expiry", type: "uint64" },
          { name: "active", type: "bool" },
          {
            name: "positions",
            type: "tuple[]",
            components: [
              { name: "account", type: "address" },
              { name: "vTokenDebt", type: "address" },
            ],
          },
        ],
      },
    ],
  },
] as const;

const REPAY_ABI = [
  {
    name: "repay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "buyer", type: "address" },
      { name: "index", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const RPC = "https://bsc-dataseed.bnbchain.org";

function client() {
  return createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 20_000 }) });
}

export async function readMandate(operator: Address, buyer: Address): Promise<Mandate | null> {
  const raw = (await client().readContract({
    address: operator,
    abi: MANDATE_ABI,
    functionName: "mandateOf",
    args: [buyer],
  })) as {
    agent: Address;
    asset: Address;
    maxRepayPerCall: bigint;
    maxRepayPerDay: bigint;
    expiry: number | bigint;
    active: boolean;
    positions: readonly { account: Address; vTokenDebt: Address }[];
  };
  if (!raw?.active) return null;
  return {
    agent: raw.agent,
    asset: raw.asset,
    maxRepayPerCall: raw.maxRepayPerCall,
    maxRepayPerDay: raw.maxRepayPerDay,
    expiry: Number(raw.expiry),
    active: raw.active,
    positions: raw.positions.map((p) => ({ account: p.account, vTokenDebt: p.vTokenDebt })),
  };
}

// the agent defends the position closest to liquidation: the lowest health
// factor is the one that costs the buyer the most if it is left alone
export function pickWorst(positions: RankedPosition[]): RankedPosition | null {
  let worst: RankedPosition | null = null;
  for (const position of positions) {
    if (!Number.isFinite(position.healthFactor)) continue;
    if (worst === null || position.healthFactor < worst.healthFactor) worst = position;
  }
  return worst;
}

// the amount to repay: enough to clear the per-call cap only when the position
// needs it, and never more than the caller passes
export function repayAmount(healthFactor: number, debt: bigint, cap: bigint, targetHealthFactor = 1.5): bigint {
  if (cap <= 0n || debt <= 0n) return 0n;
  if (!Number.isFinite(healthFactor) || healthFactor >= targetHealthFactor) return 0n;
  // raising the health factor to the target means retiring this share of debt,
  // rounded up so the defence does not undershoot the gap
  const share = 1 - healthFactor / targetHealthFactor;
  if (share <= 0) return 0n;
  const bps = BigInt(Math.round(share * 10_000));
  const wanted = (debt * bps + 9_999n) / 10_000n;
  return wanted > cap ? cap : wanted;
}

export async function repayPosition(
  operator: Address,
  buyer: Address,
  index: number,
  amount: bigint,
  agentKey: `0x${string}`,
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(agentKey);
  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC, { timeout: 20_000 }) });
  const hash = await wallet.writeContract({
    address: operator,
    abi: REPAY_ABI,
    functionName: "repay",
    args: [buyer, BigInt(index), amount],
  });
  const receipt = await client().waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`the repay transaction ${hash} reverted`);
  return hash;
}
