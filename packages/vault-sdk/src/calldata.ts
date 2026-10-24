import { encodeFunctionData } from "viem";
import { ERC20_ABI, VAULT_WRITE_ABI } from "./abi.js";

export function openCalldata(input: {
  agent: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  expiry: bigint | number;
  maxSlippageBps: number;
  fee: number;
  agentFeeBps: number;
  maxLossBps: number;
  // the buyer names the venue at open; zero means a trading-only hire that can
  // never supply anywhere. the agent cannot change it later.
  venue?: `0x${string}`;
}): `0x${string}` {
  return encodeFunctionData({
    abi: VAULT_WRITE_ABI,
    functionName: "open",
    args: [
      input.agent,
      input.token,
      input.amount,
      BigInt(input.expiry),
      input.maxSlippageBps,
      input.fee,
      input.agentFeeBps,
      input.maxLossBps,
      input.venue ?? "0x0000000000000000000000000000000000000000",
    ],
  });
}

export function tradeCalldata(
  id: bigint,
  tokenIn: `0x${string}`,
  amountIn: bigint,
  minOut: bigint = 0n,
): `0x${string}` {
  return encodeFunctionData({ abi: VAULT_WRITE_ABI, functionName: "trade", args: [id, tokenIn, amountIn, minOut] });
}

export function withdrawCalldata(id: bigint): `0x${string}` {
  return encodeFunctionData({ abi: VAULT_WRITE_ABI, functionName: "withdraw", args: [id] });
}

export function closeIfGoalCalldata(id: bigint, goalValueInToken0: bigint): `0x${string}` {
  return encodeFunctionData({ abi: VAULT_WRITE_ABI, functionName: "closeIfGoal", args: [id, goalValueInToken0] });
}

export function supplyCalldata(id: bigint, venue: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: VAULT_WRITE_ABI, functionName: "supplyToVenue", args: [id, venue, amount] });
}

export function withdrawVenueCalldata(id: bigint, venue: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: VAULT_WRITE_ABI, functionName: "withdrawFromVenue", args: [id, venue, amount] });
}

// the open pulls the deposit with transferFrom, so the buyer approves first. the
// vault clears its own allowance after every trade, and the buyer's approval is
// scoped to the exact amount, never a standing number
export function approveCalldata(spender: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] });
}
