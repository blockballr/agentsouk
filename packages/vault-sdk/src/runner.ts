import type { PublicClient, WalletClient } from "viem";
import { readVaultConfig, vaultAddressFor, type VaultConfig } from "./config.js";
import { readHire, readHiresFor, type Hire } from "./hire.js";
import { floorValue, minOutToKeepFloor, valueInToken0 } from "./guard.js";
import { tradeCalldata } from "./calldata.js";

export interface StrategyContext {
  client: PublicClient;
  config: VaultConfig;
  hire: Hire;
  // the contract's valuation at the hire's stored reference price
  value: bigint;
  // the stricter of the retained floor and the buyer's max loss
  floor: bigint;
  now: number;
}

export type Decision =
  | { action: "trade"; tokenIn: `0x${string}`; amountIn: bigint; minOut?: bigint; note?: string }
  | { action: "skip"; reason: string };

export type Strategy = (ctx: StrategyContext) => Promise<Decision> | Decision;

export interface RunReport {
  id: string;
  status: "traded" | "simulated" | "skipped" | "refused";
  reason: string | null;
  txHash: `0x${string}` | null;
  tokenIn?: `0x${string}`;
  amountIn?: string;
  minOut?: string;
}

export interface RunOptions {
  client: PublicClient;
  // the agent's own signer. a session or a relayer can be used instead by
  // calling tradeCalldata and sending it yourself
  wallet: WalletClient;
  chainId: number;
  vault?: `0x${string}`;
  strategy: Strategy;
  // simulate every trade but send none
  dryRun?: boolean;
  // one pass over the open hires. calling this on a timer is the caller's
  // choice, so a cron, a block watcher and a button all use the same runner
  maxHires?: number;
  now?: () => number;
  onReport?: (report: RunReport) => void;
  // wait for the receipt before the next hire, so a nonce is never reused
  wait?: boolean;
}

const DEFAULT_NOW = () => Math.floor(Date.now() / 1000);

// one pass, one trade per hire at most. every decision is simulated against the
// contract before it is sent, so a strategy that would breach a bound comes back
// as a refusal with the revert reason instead of burning gas.
export async function runVaultAgent(options: RunOptions): Promise<RunReport[]> {
  const { client, wallet, chainId, strategy, dryRun = false, maxHires, onReport, wait = true } = options;
  const now = options.now ?? DEFAULT_NOW;
  const agent = wallet.account?.address;
  if (!agent) throw new Error("wallet has no account; the vault trades from the agent's own address");

  const vault = vaultAddressFor(chainId, options.vault);
  const config = await readVaultConfig(client, vault);
  const ids = await readHiresFor(client, vault, agent);
  const picked = maxHires ? ids.slice(0, maxHires) : ids;

  const reports: RunReport[] = [];
  const push = (report: RunReport) => {
    reports.push(report);
    onReport?.(report);
  };

  for (const id of picked) {
    const at = now();
    let hire: Hire;
    try {
      hire = await readHire(client, vault, id);
    } catch (e) {
      push({ id: id.toString(), status: "refused", reason: message(e), txHash: null });
      continue;
    }

    if (!hire.open) {
      push({ id: id.toString(), status: "skipped", reason: "not open", txHash: null });
      continue;
    }
    if (at >= hire.expiry) {
      push({ id: id.toString(), status: "skipped", reason: "expired", txHash: null });
      continue;
    }

    const value = valueInToken0(hire, config);
    const floor = floorValue(hire, config);

    let decision: Decision;
    try {
      decision = await strategy({ client, config, hire, value, floor, now: at });
    } catch (e) {
      push({ id: id.toString(), status: "refused", reason: `strategy threw: ${message(e)}`, txHash: null });
      continue;
    }

    if (decision.action === "skip") {
      push({ id: id.toString(), status: "skipped", reason: decision.reason, txHash: null });
      continue;
    }

    const tokenIn = decision.tokenIn.toLowerCase() as `0x${string}`;
    const known = tokenIn === config.tokenA.toLowerCase() || tokenIn === config.tokenB.toLowerCase();
    if (!known) {
      push({ id: id.toString(), status: "refused", reason: "tokenIn is not one of the vault's two tokens", txHash: null });
      continue;
    }
    if (decision.amountIn <= 0n) {
      push({ id: id.toString(), status: "refused", reason: "amountIn must be positive", txHash: null });
      continue;
    }

    const minOut = decision.minOut ?? minOutToKeepFloor(hire, config, tokenIn, decision.amountIn);
    const data = tradeCalldata(id, tokenIn, decision.amountIn, minOut);
    const base = {
      id: id.toString(),
      tokenIn,
      amountIn: decision.amountIn.toString(),
      minOut: minOut.toString(),
    };

    try {
      // the contract is the judge: a trade that would break the floor, the
      // slippage cap or the expiry reverts here, before anything is sent
      await client.call({ account: agent, to: vault, data });
    } catch (e) {
      push({ ...base, status: "refused", reason: message(e), txHash: null });
      continue;
    }

    if (dryRun) {
      push({ ...base, status: "simulated", reason: decision.note ?? null, txHash: null });
      continue;
    }

    try {
      const hash = await wallet.sendTransaction({ account: agent, chain: wallet.chain, to: vault, data });
      if (wait) {
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          push({ ...base, status: "refused", reason: "the trade reverted on chain", txHash: hash });
          continue;
        }
      }
      push({ ...base, status: "traded", reason: decision.note ?? null, txHash: hash });
    } catch (e) {
      push({ ...base, status: "refused", reason: message(e), txHash: null });
    }
  }

  return reports;
}

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}
