import "server-only";
import { randomUUID } from "node:crypto";
import type { PublicClient } from "viem";
import { encodeFunctionData } from "viem";
import { vaultFor, VAULT_ABI, type HireView } from "./vault";
import { agentHireIds, readHire } from "./vault-executor";
import { bufferPolicyFromEnv, decideBuffer, initialBufferState, type BufferHireFacts, type BufferVenue } from "./buffer-policy";
import { acquireLease, getStrategyState, releaseLease } from "./strategy-store";
import { writeReceipt } from "./receipt-store";
import { hireValue0 } from "./vault-value";
import { getHirePolicy } from "./policy-registry";
import type { VaultActor } from "./vault-actor";
import { DEFAULT_VENUE_GUARD, aaveVenue, decideVenueGuard, readAaveReserveRisk, type VenueGuardOutcome, type VenueRisk } from "./venue-risk";

export const MOCK_VENUE_ADDRESS = "0x6b81b6fff9f6920b309e511159f737454870f8e8";

export function venueAddressFor(chainId: number): string {
  if (chainId === 97) return process.env.VENUE_ADDRESS_97 ?? MOCK_VENUE_ADDRESS;
  const configured = process.env.VENUE_ADDRESS_56 ?? "";
  return /^0x[0-9a-fA-F]{40}$/.test(configured) ? configured : "";
}

const MOCK_VENUE_ABI = [
  { name: "supply", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "getBalance", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "getYieldRate", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const HIRE_EXT_ABI = [{ name: "hire", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [
  { name: "buyer", type: "address" }, { name: "agent", type: "address" }, { name: "expiry", type: "uint64" },
  { name: "maxSlippageBps", type: "uint16" }, { name: "open", type: "bool" }, { name: "balanceA", type: "uint256" },
  { name: "balanceB", type: "uint256" }, { name: "refPriceX96", type: "uint160" }, { name: "fee", type: "uint24" },
  { name: "depositInToken0", type: "uint256" }, { name: "deployedB", type: "uint256" }] }] as const;

export interface BufferTradeReport {
  id: string;
  buyer: string;
  status: "traded" | "skipped" | "refused";
  reason: string | null;
  txHash: string | null;
  liquid: string | null;
  deployed: string | null;
}

export async function sweepBufferVault(
  client: PublicClient,
  chainId: number,
  actor: VaultActor,
  limit: number,
  outOfTime: () => boolean,
  execute: boolean,
): Promise<BufferTradeReport[]> {
  const agent = await actor.address();
  const vault = vaultFor(chainId);
  if (!vault) throw new Error(`no vault deployed on chain ${chainId}`);
  const venue = venueAddressFor(chainId);
  if (!venue) throw new Error(`no buffer venue is configured on chain ${chainId}`);
  const policy = bufferPolicyFromEnv(process.env);
  const kill = process.env.VAULT_KILL === "1";
  const holder = `${agent}:${randomUUID()}`;
  const ids = await agentHireIds(client, chainId, agent);
  const reports: BufferTradeReport[] = [];
  const nowSec = () => Math.floor(Date.now() / 1000);
  let head = 0;
  try { head = Number(await client.getBlockNumber()); } catch { head = 0; }

  // read mock venue yield rate
  let venueYield = 0.05;
  try {
    const rate = await client.readContract({ address: venue as `0x${string}`, abi: MOCK_VENUE_ABI, functionName: "getYieldRate" }) as bigint;
    venueYield = Number(rate) / 10000;
  } catch { /* use default */ }

  for (const id of ids.slice(0, limit)) {
    if (outOfTime()) break;
    const lease = await acquireLease(chainId, id.toString(), holder, 25 * 60 * 1000);
    if (!lease) {
      reports.push({ id: id.toString(), buyer: "", status: "skipped", reason: "another runner holds the lease", txHash: null, liquid: null, deployed: null });
      continue;
    }
    try {
      const hire = await readHire(client, chainId, id);
      const value0 = await hireValue0(client, vault, id);
      const row = { id: id.toString(), buyer: hire.buyer };
      const tagged = await getHirePolicy(chainId, id.toString());
      if (tagged !== "buffer") {
        reports.push({ ...row, status: "skipped", reason: tagged ? `hire tagged for ${tagged}, not buffer` : "hire has no policy tag", txHash: null, liquid: null, deployed: null });
        continue;
      }
      if (!hire.open || nowSec() >= hire.expiry) {
        reports.push({ ...row, status: "skipped", reason: hire.open ? "expired" : "not open", txHash: null, liquid: null, deployed: null });
        continue;
      }
      // read deployedB from the vault hire (extended ABI)
      const hireExt = await client.readContract({
        address: vault as `0x${string}`,
        abi: HIRE_EXT_ABI,
        functionName: "hire",
        args: [id],
      }) as any;
      const deployedB = BigInt(hireExt[10] ?? 0);
      const totalSleeve = hire.balanceB + deployedB;
      const deployed = deployedB;
      const liquid = hire.balanceB;

      // the venue's own state, read before the rate is trusted. a frozen reserve
      // or an exit that cannot be drawn is a reason to leave, not a number to score.
      const aave = aaveVenue(chainId);
      let risk: VenueRisk | null = null;
      let guard: VenueGuardOutcome = { action: "clear", reason: "the testnet mock carries no reserve risk" };
      if (aave) {
        try {
          risk = await readAaveReserveRisk(client, {
            pool: aave.pool as `0x${string}`,
            asset: aave.asset as `0x${string}`,
            provider: aave.provider as `0x${string}` | undefined,
            supplied: deployed,
            blockNumber: BigInt(head),
          });
          guard = decideVenueGuard(
            risk,
            { ...DEFAULT_VENUE_GUARD, minRatePct: policy.minYieldPct * 100 },
            totalSleeve,
          );
        } catch {
          guard = deployed > 0n
            ? { action: "clear", reason: "venue risk unreadable, holding the position" }
            : { action: "block", reason: "venue risk unreadable, entry waits" };
        }
      }

      const venues: BufferVenue[] = [{
        name: chainId === 97 ? "mock-venue" : "aave-v3-usdt",
        netYield: venueYield,
        exitLatencySec: 60,
        available: guard.action === "clear" && (!aave || risk !== null),
      }];
      const facts: BufferHireFacts = {
        id: hire.id,
        open: hire.open,
        expiry: hire.expiry,
        totalSleeve,
        deployed,
        liquid,
        venues,
        maxSlippageBps: hire.maxSlippageBps,
      };
      const state = await getStrategyState(chainId, id.toString());
      const bufferState = state ? { generation: state.generation, lastBlock: state.lastBlock, currentVenue: null, deployedAmount: deployed, acted: state.crossed } : null;
      const outcome = decideBuffer({
        hire: facts,
        policy,
        state: bufferState,
        blockNumber: BigInt(head),
        nowSec: nowSec(),
        kill,
      });
      // the guard outranks the rate: a venue that cannot be exited is left, and
      // the hire is not re-supplied until the reading clears
      const finalOutcome = guard.action === "pull" && deployed > 0n
        ? {
            action: "trade" as const,
            reason: `venue guard: ${guard.reason}`,
            intents: [{
              key: `${bufferState?.generation ?? 0}:guard-withdraw`,
              action: "withdraw" as const,
              venue: aave?.name ?? "venue",
              amount: deployed,
              reason: guard.reason,
            }],
            state: bufferState ?? initialBufferState(BigInt(head)),
            liquid,
            deployed,
          }
        : outcome;

      const trigger = {
        blockNumber: head,
        totalSleeve: totalSleeve.toString(),
        deployed: deployed.toString(),
        liquid: liquid.toString(),
        venueYield,
        venueRisk: risk
          ? {
              availableLiquidity: risk.availableLiquidity.toString(),
              supplied: risk.supplied.toString(),
              frozen: risk.frozen,
              paused: risk.paused,
              rateBps: risk.rateBps,
              blockNumber: risk.blockNumber,
            }
          : null,
        venueGuard: { action: guard.action, reason: guard.reason },
        venues: venues.map((v) => ({ name: v.name, netYield: v.netYield, exitLatencySec: v.exitLatencySec })),
      };
      const guardrail = {
        allowed: finalOutcome.action === "trade",
        action: finalOutcome.action,
        reason: finalOutcome.reason,
        kill,
        minBufferPct: policy.minBufferPct,
        minYieldPct: policy.minYieldPct,
      };
      const intents = finalOutcome.action === "trade" ? finalOutcome.intents : [];
      const simulation = {
        wouldTrade: intents.length > 0,
        intents: intents.map((i) => ({ action: i.action, venue: i.venue, amount: i.amount.toString() })),
      };
      const afterState = async () => {
        const post = await readHire(client, chainId, id);
        const ext = await client.readContract({ address: vault as `0x${string}`, abi: HIRE_EXT_ABI, functionName: "hire", args: [id] }) as any;
        const postDeployed = BigInt(ext[10] ?? 0);
        return { liquid: post.balanceB.toString(), deployed: postDeployed.toString(), totalSleeve: (post.balanceB + postDeployed).toString(), value0: (await hireValue0(client, vault, id))?.toString() ?? null };
      };

      if (finalOutcome.action !== "trade" || finalOutcome.intents.length === 0) {
        reports.push({ ...row, status: "skipped", reason: finalOutcome.reason, txHash: null, liquid: liquid.toString(), deployed: deployed.toString() });
        await writeReceipt({ chainId, hireId: id.toString(), agent, status: "skipped", reason: finalOutcome.reason, txHash: null, blockNumber: head, before: { liquid: liquid.toString(), deployed: deployed.toString(), value0: value0?.toString() ?? null }, after: null, trigger, guardrail, simulation, policy: "Buffer-Vault" });
        continue;
      }

      for (const intent of finalOutcome.intents) {
        if (!execute) {
          reports.push({ ...row, status: "skipped", reason: `dry run: would ${intent.action} ${intent.amount} to ${intent.venue}`, txHash: null, liquid: liquid.toString(), deployed: deployed.toString() });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "skipped", reason: `dry run: ${intent.action}`, txHash: null, blockNumber: head, before: { liquid: liquid.toString(), deployed: deployed.toString(), value0: value0?.toString() ?? null }, after: null, trigger, guardrail: { ...guardrail, allowed: true, dryRun: true }, simulation, policy: "Buffer-Vault" });
          continue;
        }
        let txHash: string;
        try {
          if (intent.action === "supply") {
            const data = encodeFunctionData({ abi: VAULT_ABI, functionName: "supplyToVenue", args: [id, venue as `0x${string}`, intent.amount] });
            txHash = await actor.trade({ to: vault as `0x${string}`, data });
          } else {
            const data = encodeFunctionData({ abi: VAULT_ABI, functionName: "withdrawFromVenue", args: [id, venue as `0x${string}`, intent.amount] });
            txHash = await actor.trade({ to: vault as `0x${string}`, data });
          }
          reports.push({ ...row, status: "traded", reason: null, txHash, liquid: liquid.toString(), deployed: deployed.toString() });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "traded", reason: null, txHash, blockNumber: head, before: { liquid: liquid.toString(), deployed: deployed.toString(), value0: value0?.toString() ?? null }, after: await afterState(), trigger, guardrail, simulation, policy: "Buffer-Vault" });
        } catch (e) {
          reports.push({ ...row, status: "refused", reason: (e as Error).message.slice(0, 200), txHash: null, liquid: liquid.toString(), deployed: deployed.toString() });
          await writeReceipt({ chainId, hireId: id.toString(), agent, status: "refused", reason: (e as Error).message.slice(0, 200), txHash: null, blockNumber: head, before: { liquid: liquid.toString(), deployed: deployed.toString(), value0: value0?.toString() ?? null }, after: null, trigger, guardrail, simulation, policy: "Buffer-Vault" });
          break;
        }
      }
    } finally {
      await releaseLease(chainId, id.toString(), holder);
    }
  }
  return reports;
}
