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
  // act when coverage falls under this, repay until it reaches the target
  trigger: number;
  target: number;
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
  // the account's debt in 1e18 dollars, used to size the repay
  debt: bigint;
  // the same debt as a decimal, for display
  debtUsd: number;
}

// Venus Core reads the collateral factor rather than the liquidation threshold,
// so this coverage is the conservative lower bound of the health factor: the
// agent defends a little earlier than the protocol's own number.
const VENUS_COMPTROLLER: Record<number, Address> = {
  56: "0xfD36E2c2a6789Db23113685031d7F16329158384",
};

const VENUS_READ_ABI = [
  { name: "getAssetsIn", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "address[]" }] },
  {
    name: "getAccountLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
  },
  { name: "oracle", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const VTOKEN_READ_ABI = [
  {
    name: "getAccountSnapshot",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
  },
] as const;

const ORACLE_READ_ABI = [
  { name: "getUnderlyingPrice", type: "function", stateMutability: "view", inputs: [{ name: "vToken", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// collateral value at the collateral factor, over debt, both in 1e18 dollars.
// a shortfall replaces the liquidity term, so the ratio stays below one.
export function coverageFrom(liquidity: bigint, shortfall: bigint, debtValue: bigint): number {
  if (debtValue <= 0n) return Number.POSITIVE_INFINITY;
  const collateral = liquidity > 0n ? liquidity + debtValue : debtValue > shortfall ? debtValue - shortfall : 0n;
  return Number((collateral * 1_000_000n) / debtValue) / 1_000_000;
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
          { name: "triggerBps", type: "uint32" },
          { name: "targetBps", type: "uint32" },
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
    triggerBps: number;
    targetBps: number;
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
    trigger: Number(raw.triggerBps) / 10_000,
    target: Number(raw.targetBps) / 10_000,
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

export async function readVenusCoverage(
  chainId: number,
  account: Address,
): Promise<{ coverage: number; debt: bigint }> {
  const comptroller = VENUS_COMPTROLLER[chainId];
  if (!comptroller) throw new Error(`no Venus comptroller is configured for chain ${chainId}`);
  const c = client();
  const assets = (await c.readContract({
    address: comptroller,
    abi: VENUS_READ_ABI,
    functionName: "getAssetsIn",
    args: [account],
  })) as readonly Address[];
  const oracle = await c.readContract({
    address: comptroller,
    abi: VENUS_READ_ABI,
    functionName: "oracle",
  });

  let debt = 0n;
  for (const asset of assets) {
    const snapshot = await c.readContract({
      address: asset,
      abi: VTOKEN_READ_ABI,
      functionName: "getAccountSnapshot",
      args: [account],
    });
    const borrowBalance = snapshot[2];
    if (borrowBalance === 0n) continue;
    const price = await c.readContract({
      address: oracle,
      abi: ORACLE_READ_ABI,
      functionName: "getUnderlyingPrice",
      args: [asset],
    });
    // the oracle scales by 1e(36 - decimals), so this lands in 1e18 dollars
    debt += (borrowBalance * price) / 10n ** 18n;
  }

  const [, liquidity, shortfall] = await c.readContract({
    address: comptroller,
    abi: VENUS_READ_ABI,
    functionName: "getAccountLiquidity",
    args: [account],
  });

  return { coverage: coverageFrom(liquidity, shortfall, debt), debt };
}

export async function rankPositions(chainId: number, positions: MandatePosition[]): Promise<RankedPosition[]> {
  const ranked: RankedPosition[] = [];
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index];
    const { coverage, debt } = await readVenusCoverage(chainId, position.account);
    ranked.push({
      ...position,
      index,
      healthFactor: coverage,
      debt,
      debtUsd: Number(debt) / 1e18,
    });
  }
  return ranked;
}

// the whole decision in one place, so the funded job and the watcher cannot
// disagree about when a position is worth defending
export function planDefence(
  ranked: RankedPosition[],
  trigger: number,
  target: number,
  cap: bigint,
): { position: RankedPosition; amount: bigint } | null {
  const worst = pickWorst(ranked);
  if (!worst || worst.healthFactor >= trigger) return null;
  const amount = repayAmount(worst.healthFactor, worst.debt, cap, target);
  if (amount === 0n) return null;
  return { position: worst, amount };
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
