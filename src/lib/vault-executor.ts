import "server-only";

import { randomUUID } from "node:crypto";
import type { PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pancakeToken } from "./pancake";
import { readPancakePrice } from "./pancake-read";
import { vaultFor, VAULT_READ_ABI, tradeCallFor, type HireView } from "./vault";
import { decideHire, policyFromEnv, refQuotePerBase, type HireFacts } from "./grid-strategy";
import { acquireLease, getStrategyState, releaseLease, saveStrategyState } from "./strategy-store";
import { getHirePolicy } from "./policy-registry";
import { writeReceipt } from "./receipt-store";
import { hireValue0 } from "./vault-value";
import type { VaultActor } from "./vault-actor";
import { configuredAgentWallets } from "./vault-actor";
import { targetChainId } from "./types";

// which wallet the executor trades from, as the page pairing needs it: the raw
// key's public address or the address a granted session carries. Unset or
// unparsable env reads as none, so a page can say plainly that no lane runs.
export async function executorWallet(): Promise<{ kind: "rawkey" | "altana"; address: string } | null> {
  const configured = process.env.AGENT_EXECUTOR_ACTOR ?? "rawkey";
  const kind: "rawkey" | "altana" = configured === "altana" ? "altana" : "rawkey";
  const addresses = await configuredAgentWallets(targetChainId());
  if (addresses.length === 0) return null;
  return { kind, address: addresses[0] };
}

export async function executorWallets(): Promise<string[]> {
  return configuredAgentWallets(targetChainId());
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
  /** set when the row carries one layer intent */
  rungIndex?: number;
  side?: string;
  amountIn?: string;
  rungPrice?: number;
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
    depositInToken0: h[9] as bigint,
  };
}

// a runner holds one hire this long; the ttl outlives any sweep, so a crashed
// runner releases the hire on the clock rather than on its exit
const LEASE_TTL_MS = 25 * 60 * 1000;

function factsOf(h: HireView, baseIsToken0: boolean): HireFacts {
  return {
    id: h.id,
    open: h.open,
    expiry: h.expiry,
    balanceA: h.balanceA,
    balanceB: h.balanceB,
    refQuotePerBase: refQuotePerBase(h.refPriceX96, baseIsToken0),
    depositInToken0: h.depositInToken0,
    maxSlippageBps: h.maxSlippageBps,
  };
}

// one report line per intent the layer raised, in the order the run touched them
export async function sweepOwnHires(
  client: PublicClient,
  chainId: number,
  actor: VaultActor,
  limit: number,
  outOfTime: () => boolean,
  execute: boolean,
): Promise<TradeReport[]> {
  const agent = await actor.address();
  const vault = vaultFor(chainId);
  const tokenA = pancakeToken(chainId, "WBNB");
  const tokenB = pancakeToken(chainId, "USDT");
  if (!tokenA || !tokenB) throw new Error(`the bound pair is not configured on chain ${chainId}`);
  if (!vault) throw new Error(`no vault deployed on chain ${chainId}`);
  const policy = policyFromEnv(process.env);
  const kill = process.env.VAULT_KILL === "1";
  // the pair's ordering decides whether the stored tick price is already quote
  // per base or its inverse. uniswap orders by address, so this is a deployment
  // fact, read once instead of per hire.
  const baseIsToken0 = tokenA.address.toLowerCase() < tokenB.address.toLowerCase();
  // one holder name per runner, so two instances can never share a lease
  const holder = `${agent}:${randomUUID()}`;
  const ids = await agentHireIds(client, chainId, agent);
  const reports: TradeReport[] = [];
  const nowSec = () => Math.floor(Date.now() / 1000);

  for (const id of ids.slice(0, limit)) {
    if (outOfTime()) break;
    const lease = await acquireLease(chainId, id.toString(), holder, LEASE_TTL_MS);
    if (!lease) {
      reports.push({
        id: id.toString(),
        buyer: "",
        status: "skipped",
        reason: "another runner holds the lease for this hire",
        txHash: null,
      });
      continue;
    }
    try {
      const hire = await readHire(client, chainId, id);
      const value0 = await hireValue0(client, vault, id);
      const row = { id: id.toString(), buyer: hire.buyer };
      const tagged = await getHirePolicy(chainId, id.toString());
      if (tagged !== "grid") {
        reports.push({
          ...row,
          status: "skipped",
          reason: tagged ? `hire tagged for ${tagged}, not grid` : "hire has no policy tag",
          txHash: null,
        });
        continue;
      }
      if (!hire.open || nowSec() >= hire.expiry) {
        reports.push({
          ...row,
          status: "skipped",
          reason: hire.open ? "expired" : "not open",
          txHash: null,
        });
        continue;
      }
      // the pool the hire's own fee tier names; its quote-per-base price is the
      // scale refPriceX96 itself carries, so the crossing is a comparison
      const quote = await readPancakePrice(chainId, tokenA.symbol, tokenB.symbol, {
        feeTier: hire.fee,
      });
      if ("error" in quote) {
        reports.push({ ...row, status: "skipped", reason: `no price mark: ${quote.error}`, txHash: null });
        continue;
      }
      const outcome = decideHire({
        hire: factsOf(hire, baseIsToken0),
        policy,
        state: await getStrategyState(chainId, id.toString()),
        price: quote.price,
        blockNumber: BigInt(quote.blockNumber),
        nowSec: nowSec(),
        kill,
      });
      await saveStrategyState(chainId, id.toString(), outcome.state);

      const intents = outcome.action === "trade" ? outcome.intents : [];
      const trigger = {
        refPrice: quote.price,
        quoteBlock: quote.blockNumber,
        rungPrice: intents[0]?.rungPrice ?? null,
        rungIndex: intents[0]?.rungIndex ?? null,
        side: intents[0]?.side ?? null,
        fee: hire.fee,
      };
      const guardrail = {
        allowed: outcome.action === "trade",
        action: outcome.action,
        reason: outcome.reason,
        kill,
      };
      const simulation = {
        wouldTrade: intents.length > 0,
        intents: intents.map((i) => ({ rungIndex: i.rungIndex, side: i.side, tokenInSide: i.tokenInSide, amountIn: i.amountIn.toString(), rungPrice: i.rungPrice })),
      };

      if (outcome.action !== "trade" || outcome.intents.length === 0) {
        reports.push({ ...row, status: "skipped", reason: outcome.reason, txHash: null });
        await writeReceipt({ chainId, hireId: id.toString(), agent, status: "skipped", reason: outcome.reason, txHash: null, blockNumber: quote.blockNumber, before: { balanceA: hire.balanceA.toString(), balanceB: hire.balanceB.toString(), value0: value0?.toString() ?? null }, after: null, trigger, guardrail, simulation, policy: "Grid" });
        continue;
      }
      for (const intent of outcome.intents) {
        const line = {
          ...row,
          rungIndex: intent.rungIndex,
          side: intent.side,
          amountIn: intent.amountIn.toString(),
          rungPrice: intent.rungPrice,
        };
        if (!execute) {
          reports.push({
            ...line,
            status: "skipped",
            reason: `dry run: would ${intent.side} ${intent.amountIn} of token ${intent.tokenInSide} at rung ${intent.rungIndex} (${intent.rungPrice})`,
            txHash: null,
          });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "skipped", reason: `dry run: ${intent.side}`, txHash: null, blockNumber: quote.blockNumber, before: { balanceA: hire.balanceA.toString(), balanceB: hire.balanceB.toString(), value0: value0?.toString() ?? null }, after: null, trigger, guardrail: { ...guardrail, allowed: true, dryRun: true }, simulation, policy: "Grid" });
          continue;
        }
        const data = tradeCallFor(
          id,
          intent.tokenInSide === "A" ? tokenA.address : tokenB.address,
          intent.amountIn,
        );
        try {
          const txHash = await actor.trade({ to: vault as `0x${string}`, data });
          reports.push({ ...line, status: "traded", reason: null, txHash });
          const post = await readHire(client, chainId, id);
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "traded", reason: null, txHash, blockNumber: quote.blockNumber, before: { balanceA: hire.balanceA.toString(), balanceB: hire.balanceB.toString(), value0: value0?.toString() ?? null }, after: { balanceA: post.balanceA.toString(), balanceB: post.balanceB.toString(), value0: (await hireValue0(client, vault, id))?.toString() ?? null }, trigger, guardrail, simulation, policy: "Grid" });
        } catch (e) {
          // the contract is the last line: one refusal stops this hire's intents
          reports.push({
            ...line,
            status: "refused",
            reason: (e as Error).message.slice(0, 200),
            txHash: null,
          });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "refused", reason: (e as Error).message.slice(0, 200), txHash: null, blockNumber: quote.blockNumber, before: { balanceA: hire.balanceA.toString(), balanceB: hire.balanceB.toString(), value0: value0?.toString() ?? null }, after: null, trigger, guardrail, simulation, policy: "Grid" });
          break;
        }
      }
    } finally {
      await releaseLease(chainId, id.toString(), holder);
    }
  }
  return reports;
}
