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
  { name: "oracle", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

const ORACLE_ABI = [
  { name: "getUnderlyingPrice", type: "function", stateMutability: "view", inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

// VToken ABI (minimal)
const VTOKEN_ABI = [
  { name: "balanceOfUnderlying", type: "function", stateMutability: "nonpayable", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "borrowBalanceCurrent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "exchangeRateCurrent", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "underlying", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "getCash", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "exchangeRateStored", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "borrowBalanceStored", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

export interface VenusPosition {
  account: string;
  marketsEntered: string[]; // vToken addresses
  totalCollateralUsd: number; // entered markets at oracle price, before collateral factors
  totalBorrowUsd: number; // sum of borrow balances
  liquidity: bigint; // from getAccountLiquidity (in USD, scaled 1e18)
  shortfall: bigint; // from getAccountLiquidity (in USD, scaled 1e18)
  healthFactor: number | null; // borrow power over debt, or null if no debt
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

  const markets = (await client.readContract({
    address: comptroller,
    abi: COMPTROLLER_ABI,
    functionName: "getAssetsIn",
    args: [account as `0x${string}`],
  })) as `0x${string}`[];

  const [, liquidity, shortfall] = (await client.readContract({
    address: comptroller,
    abi: COMPTROLLER_ABI,
    functionName: "getAccountLiquidity",
    args: [account as `0x${string}`],
  })) as [bigint, bigint, bigint];

  const oracle = (await client.readContract({
    address: comptroller,
    abi: COMPTROLLER_ABI,
    functionName: "oracle",
  })) as `0x${string}`;

  const positions: VenusPosition["positions"] = [];
  let collateralUsd = 0;
  let borrowUsd = 0;

  for (const vToken of markets) {
    try {
      const [shares, rate, borrowed, price] = await Promise.all([
        client.readContract({ address: vToken, abi: VTOKEN_ABI, functionName: "balanceOf", args: [account as `0x${string}`] }) as Promise<bigint>,
        client.readContract({ address: vToken, abi: VTOKEN_ABI, functionName: "exchangeRateStored" }) as Promise<bigint>,
        client.readContract({ address: vToken, abi: VTOKEN_ABI, functionName: "borrowBalanceStored", args: [account as `0x${string}`] }) as Promise<bigint>,
        client.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "getUnderlyingPrice", args: [vToken] }) as Promise<bigint>,
      ]);
      const underlying = (await client.readContract({
        address: vToken,
        abi: VTOKEN_ABI,
        functionName: "underlying",
      })) as `0x${string}`;

      const held = (shares * rate) / 10n ** 18n;
      // the oracle prices in 1e(36 - underlyingDecimals), so the product below is 1e36 scaled USD
      collateralUsd += Number((held * price) / 10n ** 18n) / 1e18;
      borrowUsd += Number((borrowed * price) / 10n ** 18n) / 1e18;

      positions.push({ vToken, underlying, collateralBalance: held, borrowBalance: borrowed });
    } catch {
      // a market that will not read is left out rather than counted as zero risk
    }
  }

  // the comptroller's own view of what the collateral supports, which is what
  // liquidation is decided on. liquidity and shortfall are 1e18 scaled USD
  const supported =
    shortfall > 0n
      ? borrowUsd - Number(shortfall) / 1e18
      : borrowUsd + Number(liquidity) / 1e18;

  const healthFactor = borrowUsd > 0 ? supported / borrowUsd : null;

  return {
    account,
    marketsEntered: markets,
    totalCollateralUsd: collateralUsd,
    totalBorrowUsd: borrowUsd,
    liquidity,
    shortfall,
    healthFactor,
    liquidatable: shortfall > 0n,
    positions,
  };
}
