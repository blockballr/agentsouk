import "server-only";

import {
  createPublicClient,
  encodeFunctionData,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pancakeToken } from "./pancake";
import { vaultFor, VAULT_READ_ABI, tradeIntent, type HireView } from "./vault";
import type { VaultActor } from "./vault-actor";

// which wallet the executor trades from, as the page pairing needs it: the raw
// key's public address or the address a granted session carries. Unset or
// unparsable env reads as none, so a page can say plainly that no lane runs.
export function executorWallet(): { kind: "rawkey" | "altana"; address: string } | null {
  const configured = process.env.AGENT_EXECUTOR_ACTOR;
  if (configured === "rawkey") {
    const key = process.env.AGENT_EXECUTOR_KEY as `0x${string}` | undefined;
    if (!key) return null;
    try {
      return { kind: "rawkey", address: privateKeyToAccount(key).address };
    } catch {
      return null;
    }
  }
  if (configured === "altana") {
    let session: unknown;
    try {
      session = JSON.parse(process.env.AGENT_ALTANA_SESSION ?? "");
    } catch {
      return null;
    }
    const walletAddress = (session as { wallet?: { address?: string } })?.wallet?.address;
    return typeof walletAddress === "string" && walletAddress
      ? { kind: "altana", address: walletAddress }
      : null;
  }
  return null;
}

// the executor half of the split. The actor (raw key today, a granted session
// at cutover) owns the initiating side; the vault owns what moves and it never
//the reverse: no trade can happen without open(), and no key in this half can
// move a deposit outside trade()'s stored floor.

export interface TradeReport {
  id: string;
  buyer: string;
  status: "traded" | "skipped" | "refused";
  reason: string | null;
  txHash: string | null;
}

// every open hire that names this actor is in scope and only it: the actor
// cannot see, trade, or drain a hire that named a different address
export async function agentHireIds(
  client: PublicClient,
  chainId: number,
  agent: string,
): Promise<bigint[]> {
  const vault = vaultFor(chainId);
  if (!vault) throw new Error(`no vault deployed on chain ${chainId}`);
  const ids = await client.readContract({
    address: vault as `0x${string}`,
    abi: VAULT_READ_ABI,
    functionName: "hiresFor",
    args: [agent as `0x${string}`],
  });
  return ids as unknown as bigint[];
}

export async function readHire(
  client: PublicClient,
  chainId: number,
  id: bigint,
): Promise<HireView> {
  const vault = vaultFor(chainId);
  if (!vault) throw new Error(`no vault deployed on chain ${chainId}`);
  const hire = await client.readContract({
    address: vault as `0x${string}`,
    abi: VAULT_READ_ABI,
    functionName: "hire",
    args: [id],
  });
  const h = hire as unknown as readonly unknown[];
  return {
    id,
    buyer: String(h[0]),
    agent: String(h[1]),
    expiry: Number(h[2]),
    maxSlippageBps: Number(h[3]),
    open: !!h[4],
    balanceA: h[5] as bigint,
    balanceB: h[6] as bigint,
    refPriceX96: h[7] as bigint,
    fee: Number(h[8]),
  };
}

export type TradePolicy = ReturnType<typeof tradeIntent>;

// one report line per candidate hire, in the order the run would touch them
export async function sweepOwnHires(
  client: PublicClient,
  chainId: number,
  actor: VaultActor,
  limit: number,
  outOfTime: () => boolean,
  execute: boolean,
): Promise<TradeReport[]> {
  const agent = await actor.address();
  const tokenA = pancakeToken(chainId, "WBNB");
  const tokenB = pancakeToken(chainId, "USDT");
  if (!tokenA || !tokenB) throw new Error(`the bound pair is not configured on chain ${chainId}`);
  const ids = await agentHireIds(client, chainId, agent);
  const reports: TradeReport[] = [];
  for (const id of ids.slice(0, limit)) {
    if (outOfTime()) break;
    const hire = await readHire(client, chainId, id);
    const intent = tradeIntent(hire, tokenA.address, tokenB.address);
    if (!intent) {
      reports.push({ id: id.toString(), buyer: hire.buyer, status: "skipped", reason: hire.open ? "expired" : "not open", txHash: null });
      continue;
    }
    if (!execute) {
      // a dry run rehearses everything but the send, and says so per row
      reports.push({ id: id.toString(), buyer: hire.buyer, status: "skipped", reason: "dry run: VAULT_EXECUTE not set", txHash: null });
      continue;
    }
    // the call points at the vault, the data at trade(); one shared shape so
    // both custody halves send the identical payload
    const call = { to: vaultFor(chainId) as `0x${string}`, data: intent.calldata };
    try {
      const txHash = await actor.trade(call);
      reports.push({ id: id.toString(), buyer: hire.buyer, status: "traded", reason: null, txHash });
    } catch (e) {
      reports.push({ id: id.toString(), buyer: hire.buyer, status: "refused", reason: (e as Error).message.slice(0, 200), txHash: null });
    }
  }
  return reports;
}
