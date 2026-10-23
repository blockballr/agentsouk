import type { PublicClient } from "viem";
import { venueById } from "./venue-registry";

// The yield sleeve is only as safe as its exit. The buffer policy scores the
// rate; this reads the venue's own state for the risks a rate cannot show:
// whether the reserve is frozen or paused, whether enough liquidity is left to
// withdraw, and whether the rate has collapsed under the floor.
//
// It never supplies. It answers pull, block or clear, and the buffer runner acts
// with the verbs the hire already has.

export interface VenueRisk {
  availableLiquidity: bigint;
  /** the hire's own position, for the ratio checks */
  supplied: bigint;
  frozen: boolean;
  paused: boolean;
  rateBps: number;
  blockNumber: number;
}

export interface VenueGuardPolicy {
  /** pull when available liquidity is below this multiple of our position */
  minLiquidityRatio: number;
  /** do not enter unless available liquidity is this many times the deposit */
  reentryLiquidityRatio: number;
  /** the rate floor, as a percentage */
  minRatePct: number;
}

export const DEFAULT_VENUE_GUARD: VenueGuardPolicy = {
  minLiquidityRatio: 2,
  reentryLiquidityRatio: 3,
  // percent, matching the rate the guard compares against
  minRatePct: 1,
};

export type VenueGuardOutcome =
  | { action: "pull"; reason: string }
  | { action: "block"; reason: string }
  | { action: "clear"; reason: string };

export function decideVenueGuard(
  risk: VenueRisk,
  policy: VenueGuardPolicy = DEFAULT_VENUE_GUARD,
  entryAmount: bigint = risk.supplied,
): VenueGuardOutcome {
  if (risk.paused || risk.frozen) {
    const state = risk.paused ? "paused" : "frozen";
    return risk.supplied > 0n
      ? { action: "pull", reason: `the venue is ${state}` }
      : { action: "block", reason: `the venue is ${state}` };
  }

  const ratePct = risk.rateBps / 100;
  if (ratePct < policy.minRatePct) {
    return risk.supplied > 0n
      ? { action: "pull", reason: `the venue pays ${ratePct.toFixed(2)}%, below the ${policy.minRatePct}% floor` }
      : { action: "block", reason: `the venue pays ${ratePct.toFixed(2)}%, below the ${policy.minRatePct}% floor` };
  }

  const minLiquidity = mulRatio(risk.supplied, policy.minLiquidityRatio);
  if (risk.supplied > 0n && risk.availableLiquidity < minLiquidity) {
    return {
      action: "pull",
      reason: `available liquidity ${risk.availableLiquidity} is below ${policy.minLiquidityRatio}x the ${risk.supplied} supplied`,
    };
  }

  const entryFloor = mulRatio(entryAmount, policy.reentryLiquidityRatio);
  if (risk.supplied === 0n && entryAmount > 0n && risk.availableLiquidity < entryFloor) {
    return {
      action: "block",
      reason: `available liquidity is below ${policy.reentryLiquidityRatio}x the deposit, so entry waits`,
    };
  }

  return { action: "clear", reason: "the venue is open, liquid and paying" };
}

function mulRatio(value: bigint, ratio: number): bigint {
  const scaled = BigInt(Math.round(ratio * 1000));
  return (value * scaled) / 1000n;
}

const POOL_ABI = [
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "configuration", type: "uint256" },
      { name: "liquidityIndex", type: "uint128" },
      { name: "currentLiquidityRate", type: "uint128" },
      { name: "variableBorrowIndex", type: "uint128" },
      { name: "currentVariableBorrowRate", type: "uint128" },
      { name: "currentStableBorrowRate", type: "uint128" },
      { name: "lastUpdateTimestamp", type: "uint40" },
      { name: "id", type: "uint16" },
      { name: "aTokenAddress", type: "address" },
      { name: "stableDebtTokenAddress", type: "address" },
      { name: "variableDebtTokenAddress", type: "address" },
      { name: "interestRateStrategyAddress", type: "address" },
      { name: "accruedToTreasury", type: "uint128" },
      { name: "unbacked", type: "uint128" },
      { name: "isolationModeTotalDebt", type: "uint128" },
    ],
  },
] as const;

const PROVIDER_ABI = [
  { name: "getPoolDataProvider", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const DATA_PROVIDER_ABI = [
  {
    name: "getReserveConfigurationData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "decimals", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "liquidationThreshold", type: "uint256" },
      { name: "liquidationBonus", type: "uint256" },
      { name: "reserveFactor", type: "uint256" },
      { name: "usageAsCollateralEnabled", type: "bool" },
      { name: "borrowingEnabled", type: "bool" },
      { name: "stableBorrowRateEnabled", type: "bool" },
      { name: "isActive", type: "bool" },
      { name: "isFrozen", type: "bool" },
    ],
  },
] as const;

const ERC20_BALANCE = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// Aave V3 keeps the supplied underlying in the aToken contract, so its balance
// is the liquidity a withdrawal can actually draw on. The pool's own
// getReserveConfigurationData is not present on every deployment, so the
// protocol data provider is read when the registry names one. The reserve is
// paused when it is not active, and frozen when it is active but closed to new
// supply.
export async function readAaveReserveRisk(
  client: PublicClient,
  input: { pool: `0x${string}`; asset: `0x${string}`; provider?: `0x${string}`; supplied: bigint; blockNumber?: bigint },
): Promise<VenueRisk> {
  const block = input.blockNumber;
  const dataProvider = input.provider
    ? ((await client.readContract({
        address: input.provider,
        abi: PROVIDER_ABI,
        functionName: "getPoolDataProvider",
        blockNumber: block,
      })) as `0x${string}`)
    : input.pool;
  const [data, config] = await Promise.all([
    client.readContract({ address: input.pool, abi: POOL_ABI, functionName: "getReserveData", args: [input.asset], blockNumber: block }),
    client.readContract({ address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getReserveConfigurationData", args: [input.asset], blockNumber: block }),
  ]);
  const aToken = data[8];
  const rateRay = data[2];
  const isActive = config[8];
  const isFrozen = config[9];
  const availableLiquidity = (await client.readContract({
    address: input.asset,
    abi: ERC20_BALANCE,
    functionName: "balanceOf",
    args: [aToken],
    blockNumber: block,
  })) as bigint;

  return {
    availableLiquidity,
    supplied: input.supplied,
    frozen: isFrozen,
    paused: !isActive,
    // the liquidity rate is a ray (1e27); basis points are the rate * 1e4
    rateBps: Number((rateRay * 10_000n) / 10n ** 27n),
    blockNumber: Number(block ?? (await client.getBlockNumber())),
  };
}

// the official Aave V3 USDT venue, from the same registry the runner reads
export function aaveVenue(chainId: number) {
  const venue = venueById("aave-v3-usdt");
  if (!venue || venue.chainId !== chainId) return null;
  return venue;
}
