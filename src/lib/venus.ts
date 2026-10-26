// Venus lending position reader for BSC.
// Reads a buyer's lending position from Venus Protocol (comptroller + vTokens).
// Used by the lending-defense agent to monitor health factors and decide
// when to defend (sell collateral, repay debt).

import { createPublicClient, http, formatUnits, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "./rpc";

// Venus Protocol addresses (BSC mainnet, chain 56)
export const VENUS_MAINNET = {
  chainId: 56,
  comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384" as `0x${string}`,
  lens: "0xe797804c5d4410777c70EF8769c4eB9C39BEF662" as `0x${string}`,
  vUSDT: "0xfD5840Cd36d94D7229439859C0112a4185BC0255" as `0x${string}`,
  vBNB: "0xA07c5b74C9B40447a954e1466938b865b6BBea36" as `0x${string}`,
  vBUSD: "0x95c78222B3D6e262426483D42CfA53685A67Ab9D" as `0x${string}`,
  vUSDC: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8" as `0x${string}`,
};

// Venus Comptroller ABI (minimal)
const COMPTROLLER_ABI = [
  { name: "getAccountLiquidity", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "error", type: "uint256" }, { name: "liquidity", type: "uint256" }, { name: "shortfall", type: "uint256" }] },
  { name: "marketsEntered", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "address[]" }] },
  { name: "getAssetsIn", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "address[]" }] },
  { name: "markets", type: "function", stateMutability: "view", inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "isListed", type: "bool" }, { name: "collateralFactorMantissa", type: "uint256" }, { name: "isVenus", type: "bool" }] },
] as const;

// VToken ABI (minimal)
const VTOKEN_ABI = [
  { name: "balanceOfUnderlying", type: "function", stateMutability: "nonpayable", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "borrowBalanceCurrent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "exchangeRateCurrent", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "underlying", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "getCash", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

export interface VenusPosition {
  account: string;
  marketsEntered: string[]; // vToken addresses
  totalCollateralUsd: number; // sum of underlying values of entered markets
  totalBorrowUsd: number; // sum of borrow balances
  liquidity: bigint; // from getAccountLiquidity (in USD, scaled 1e18)
  shortfall: bigint; // from getAccountLiquidity (in USD, scaled 1e18)
  healthFactor: number | null; // collateral/borrow ratio, or null if no debt
  liquidatable: boolean; // shortfall > 0
  positions: Array<{
    vToken: string;
    underlying: string;
    collateralBalance: bigint; // balanceOfUnderlying
    borrowBalance: bigint; // borrowBalanceCurrent
  }>;
}

export async function readVenusPosition(
  client: PublicClient,
  account: string,
): Promise<VenusPosition> {
  const comptroller = VENUS_MAINNET.comptroller;

  // Get markets entered
  const markets = await client.readContract({
    address: comptroller,
    abi: COMPTROLLER_ABI,
    functionName: "marketsEntered",
    args: [account as `0x${string}`],
  }) as `0x${string}`[];

  // Get account liquidity
  const [error, liquidity, shortfall] = await client.readContract({
    address: comptroller,
    abi: COMPTROLLER_ABI,
    functionName: "getAccountLiquidity",
    args: [account as `0x${string}`],
  }) as [bigint, bigint, bigint];

  // Read each position
  const positions: VenusPosition["positions"] = [];
  let totalCollateral = 0n;
  let totalBorrow = 0n;

  for (const vToken of markets) {
    try {
      const [collateral, borrow] = await Promise.all([
        client.readContract({ address: vToken, abi: VTOKEN_ABI as any, functionName: "balanceOfUnderlying", args: [account as `0x${string}`] }) as Promise<bigint>,
        client.readContract({ address: vToken, abi: VTOKEN_ABI as any, functionName: "borrowBalanceCurrent", args: [account as `0x${string}`] }) as Promise<bigint>,
      ]);
      const underlying = await client.readContract({ address: vToken, abi: VTOKEN_ABI as any, functionName: "underlying" }) as `0x${string}`;
      positions.push({ vToken, underlying, collateralBalance: collateral, borrowBalance: borrow });
      totalCollateral += collateral;
      totalBorrow += borrow;
    } catch {
      // skip markets that fail to read
    }
  }

  // Health factor (simplified: collateral/borrow ratio)
  let healthFactor: number | null = null;
  if (totalBorrow > 0n) {
    healthFactor = Number(totalCollateral) / Number(totalBorrow);
  }

  return {
    account,
    marketsEntered: markets,
    totalCollateralUsd: 0, // TODO: convert using price oracle
    totalBorrowUsd: 0,
    liquidity,
    shortfall,
    healthFactor,
    liquidatable: shortfall > 0n,
    positions,
  };
}

export function venusComptroller(chainId: number): string | null {
  if (chainId !== 56) return null; // Venus is on mainnet only
  return VENUS_MAINNET.comptroller;
}
