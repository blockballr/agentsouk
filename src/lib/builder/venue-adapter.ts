// Venue adapter: defines how a custom agent calls a specific on-chain venue
// through the vault. Only the vault swap is supported today. LP and Altana
// are not implemented and are deliberately absent from the allowlist.

import "server-only";

export interface VenueAction {
  name: string;
  venue: string;
  contracts: string[];
  functions: string[];
  maxValueUsd: number;
}

export interface VenueAdapter {
  name: string;
  venue: string;
  buildSwapCall(params: {
    tokenIn: string;
    amountIn: bigint;
    minOut: bigint;
  }): { to: string; data: string; value: bigint };
  buildLpCall?(params: {
    token0: string;
    token1: string;
    fee: number;
    tickLower: number;
    tickUpper: number;
    amount0: bigint;
    amount1: bigint;
  }): { to: string; data: string; value: bigint };
}

// PancakeSwap V3 venue adapter (BSC mainnet + testnet).
export const pancakeV3Adapter: VenueAdapter = {
  name: "pancake-v3",
  venue: "pancakeswap-v3",
  buildSwapCall(params) {
    return {
      to: "0x0000000000000000000000000000000000000000",
      data: "0x",
      value: 0n,
    };
  },
};

// Allowlist: which venue actions are permitted for hirer-funded execution.
// A custom agent can only execute actions that are in its manifest AND in this
// allowlist. Only the vault swap is supported; LP and Altana are not.
export const HIRER_ALLOWLIST: Record<string, VenueAction[]> = {
  "pancakeswap-v3": [
    {
      name: "swap",
      venue: "pancakeswap-v3",
      contracts: ["0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"],
      functions: ["exactInputSingle"],
      maxValueUsd: 500,
    },
  ],
};

export function isAllowlisted(action: VenueAction): boolean {
  const allowed = HIRER_ALLOWLIST[action.venue];
  if (!allowed) return false;
  return allowed.some(
    (a) =>
      a.name === action.name &&
      (a.contracts.length === 0 || a.contracts.some((c) => action.contracts.includes(c))) &&
      a.functions.some((f) => action.functions.includes(f)) &&
      action.maxValueUsd <= a.maxValueUsd,
  );
}
