// server-only reads behind the team panel's pages; the working out is in station-view.ts

import "server-only";
import { createPublicClient, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { CATEGORY_KEYS } from "@agora/core";
import { hydrateBoostsFromDb, isBoosted } from "./boosts";
import { loadDelistedRows } from "./delist-store";
import { durableMode } from "./durable-store";
import { resolveFacilitatorMode } from "./facilitator-mode";
import { formatUnits } from "./format";
import { loadHireTasksByStatus, loadJobsByPayments, loadJobsByStatus } from "./durable-store";
import { checksSince, latestCronRuns } from "./history-store";
import { listJobs } from "./jobs";
import { countPassports } from "./passport-store";
import { countCheckPayments, listOutsidePayments, listRecentPayments, receiptsMode } from "./receipts-store";
import { rpcTransport } from "./rpc";
import { queryAgents } from "./scanner";
import { shelfStoreMode } from "./shelf-store";
import {
  checkPassed,
  checksByDay,
  countByDay,
  isSettled,
  payerKind,
  stuckItems,
  windowFigures,
  type PaymentRow,
  type StuckItem,
  type WindowFigures,
} from "./station-view";
import { listTasks, listTasksForPayments } from "./tasks";
import { TEAM_WALLETS, isTeamWallet } from "./team-wallets";
import { BSC_TESTNET_CHAIN_ID, settlementAsset, targetChainId } from "./types";
import { loadVerifications } from "./verifications";
import { loadStaleTokens } from "./verifications-store";

const DAY_MS = 86_400_000;
const CRON_JOBS = ["verify", "refresh", "maintenance", "pancake"] as const;
const BUYER_WINDOW = 5000;

function paymentRows(payments: Awaited<ReturnType<typeof listRecentPayments>>): PaymentRow[] {
  return payments.map((p) => {
    let decimals: number | null = null;
    let symbol = p.symbol;
    try {
      const asset = settlementAsset(p.agent.chainId);
      decimals = asset.decimals;
      symbol = asset.symbol;
    } catch {
      // an unconfigured chain leaves the amount unformatted
    }
    return {
      paymentId: p.paymentId,
      createdAt: p.createdAt,
      client: p.client,
      payTo: p.payTo,
      amount: p.amount,
      symbol,
      decimals,
      mode: p.mode,
      chainId: p.agent.chainId,
      tokenId: p.agent.tokenId,
      agentName: p.agent.name,
      txHash: p.txHash ?? null,
    };
  });
}

export interface StationOverview {
  generatedAt: string;
  chainId: number;
  windows: WindowFigures[];
  categories: { key: string; listed: number; answering: number }[];
  agentsListed: number;
  agentsAnswering: number;
  offMarket: number;
  passports: number | null;
  failedChecksToday: number;
  // true when there are more buyer receipts than were read, so the all-time figures are a floor
  buyersTruncated: boolean;
  // oldest first, one entry per day
  hiresByDay: { day: string; count: number }[];
  checksByDay: { day: string; passed: number; failed: number }[];
  jobs: { name: string; lastRunAt: string | null; ok: boolean | null; note: string | null }[];
  stuck: StuckItem[];
}

// with a durable store the stuck rows are chosen in the query; without one, from what memory holds
async function stuckRows(): Promise<[Awaited<ReturnType<typeof listJobs>>, Awaited<ReturnType<typeof listTasks>>]> {
  if (durableMode() !== "postgres") return Promise.all([listJobs(500), listTasks(500)]);
  const chainId = targetChainId();
  const [jobs, tasks] = await Promise.all([loadJobsByStatus("Funded"), loadHireTasksByStatus("failed")]);
  return [jobs.filter((j) => Number(j.chainId) === chainId), tasks.filter((t) => Number(t.chainId) === chainId)];
}

export async function stationOverview(now = Date.now()): Promise<StationOverview> {
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  const week = now - 7 * DAY_MS;
  const [outside, ownChecks, catalogue, verifications, delisted, checks, runs, [jobs, tasks], passports] = await Promise.all([
    listOutsidePayments([...TEAM_WALLETS], BUYER_WINDOW),
    countCheckPayments([today, week, 0]),
    queryAgents({ limit: 5000, includeDelisted: true, includeHouse: true }),
    loadVerifications(),
    loadDelistedRows(),
    checksSince(new Date(now - 14 * DAY_MS)),
    latestCronRuns(),
    stuckRows(),
    countPassports(),
  ]);
  const rows = paymentRows(outside);
  const onShelf = catalogue.items.filter((a) => !delisted.has(a.token_id));
  const answers = (tokenId: string) => verifications.get(tokenId)?.status === "delivered";
  const buyers = rows.filter((p) => isSettled(p) && payerKind(p) === "buyer");
  const window = (key: WindowFigures["key"], since: number, checksCount: number): WindowFigures => ({
    ...windowFigures(rows, key, since),
    ownChecks: checksCount,
  });
  return {
    generatedAt: new Date(now).toISOString(),
    chainId: targetChainId(),
    windows: [window("today", today, ownChecks[0]), window("week", week, ownChecks[1]), window("all", 0, ownChecks[2])],
    buyersTruncated: outside.length >= BUYER_WINDOW,
    categories: CATEGORY_KEYS.map((key) => {
      const listed = onShelf.filter((a) => a.category === key);
      return { key, listed: listed.length, answering: listed.filter((a) => answers(a.token_id)).length };
    }),
    agentsListed: onShelf.length,
    agentsAnswering: onShelf.filter((a) => answers(a.token_id)).length,
    offMarket: catalogue.items.length - onShelf.length,
    passports,
    failedChecksToday: checks.filter((c) => Date.parse(c.checkedAt) >= today && !checkPassed(c.status)).length,
    hiresByDay: countByDay(buyers.map((p) => p.createdAt), 14, now),
    checksByDay: checksByDay(checks, 14, now),
    jobs: CRON_JOBS.map((name) => {
      const run = runs.find((r) => r.name === name);
      return { name, lastRunAt: run?.finishedAt ?? null, ok: run ? run.ok : null, note: run?.note ?? null };
    }),
    stuck: stuckItems(jobs, tasks, now),
  };
}

export interface StationAgent {
  tokenId: string;
  name: string;
  category: string;
  owner: string;
  ours: boolean;
  status: string;
  checkedAt: string | null;
  detail: string | null;
  failingSince: string | null;
  delisted: { reason: string | null; at: string | null } | null;
  boosted: boolean;
}

export async function stationAgents(): Promise<StationAgent[]> {
  const chainId = targetChainId();
  const [catalogue, verifications, delisted, stale] = await Promise.all([
    queryAgents({ limit: 5000, includeDelisted: true, includeHouse: true }),
    loadVerifications(),
    loadDelistedRows(),
    loadStaleTokens(0),
    hydrateBoostsFromDb(),
  ]);
  const failingSince = new Map(stale.map((t) => [t.tokenId, t.failingSince]));
  return catalogue.items.map((a) => {
    const v = verifications.get(a.token_id);
    const off = delisted.get(a.token_id);
    return {
      tokenId: a.token_id,
      name: a.name,
      category: a.category ?? "general",
      owner: a.owner_address,
      ours: isTeamWallet(a.owner_address),
      status: v?.status ?? "unchecked",
      checkedAt: v?.checkedAt ?? null,
      detail: v?.detail ? v.detail.slice(0, 240) : null,
      failingSince: failingSince.get(a.token_id) ?? null,
      delisted: off ? { reason: off.reason ?? null, at: off.delistedAt ?? null } : null,
      boosted: isBoosted(chainId, a.token_id),
    };
  });
}

export interface StationHire {
  paymentId: string;
  createdAt: string;
  agentName: string;
  tokenId: string;
  client: string;
  payer: string;
  amount: string;
  symbol: string;
  mode: string;
  txHash: string | null;
  job: string | null;
  task: string | null;
}

export async function stationHires(limit = 200): Promise<StationHire[]> {
  const rows = paymentRows(await listRecentPayments(limit));
  const ids = rows.map((p) => p.paymentId);
  // read by payment, so each receipt finds its own job and task however many are newer
  const [jobs, tasks] = await Promise.all([
    durableMode() === "postgres" ? loadJobsByPayments(ids) : listJobs(500),
    listTasksForPayments(ids),
  ]);
  const jobOf = new Map(jobs.flatMap((j) => (j.paymentId ? [[j.paymentId, j.status] as const] : [])));
  const taskOf = new Map(tasks.map((t) => [t.paymentId, t.status] as const));
  return rows.map((p) => {
    let amount = p.amount;
    if (p.decimals !== null) {
      try {
        amount = formatUnits(BigInt(p.amount), p.decimals);
      } catch {
        // left raw when it cannot be read
      }
    }
    return {
      paymentId: p.paymentId,
      createdAt: p.createdAt,
      agentName: p.agentName,
      tokenId: p.tokenId,
      client: p.client,
      payer: payerKind(p),
      amount,
      symbol: p.symbol,
      mode: p.mode,
      txHash: p.txHash,
      job: jobOf.get(p.paymentId) ?? null,
      task: taskOf.get(p.paymentId) ?? null,
    };
  });
}

export interface StationOperations {
  generatedAt: string;
  chainId: number;
  settlement: string;
  jobs: { name: string; startedAt: string | null; finishedAt: string | null; ok: boolean | null; note: string | null }[];
  relay: { address: string | null; balance: string | null; note: string | null };
  stores: { name: string; mode: string; durable: boolean }[];
}

// the relay's own address and gas balance
// the key never leaves this function, and a failed read answers one fixed line
async function relayState(chainId: number): Promise<StationOperations["relay"]> {
  const key = process.env.RELAY_PRIVATE_KEY;
  if (!key) return { address: null, balance: null, note: "No relay key is configured on this deployment." };
  try {
    const address = privateKeyToAccount(key as `0x${string}`).address;
    const client = createPublicClient({ chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc, transport: rpcTransport(chainId) });
    const wei = await Promise.race([
      client.getBalance({ address }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the chain did not answer in time")), 6000)),
    ]);
    return { address, balance: formatEther(wei), note: null };
  } catch (e) {
    console.error("[station] relay not read", e instanceof Error ? e.message.slice(0, 200) : String(e));
    return { address: null, balance: null, note: "The relay's balance could not be read just now." };
  }
}

export async function stationOperations(now = Date.now()): Promise<StationOperations> {
  const chainId = targetChainId();
  const [runs, relay] = await Promise.all([latestCronRuns(), relayState(chainId)]);
  let settlement = "unknown";
  try {
    settlement = resolveFacilitatorMode(process.env.FACILITATOR_MODE);
  } catch {
    settlement = "misconfigured";
  }
  const database = Boolean(process.env.DATABASE_URL);
  return {
    generatedAt: new Date(now).toISOString(),
    chainId,
    settlement,
    jobs: CRON_JOBS.map((name) => {
      const run = runs.find((r) => r.name === name);
      return { name, startedAt: run?.startedAt ?? null, finishedAt: run?.finishedAt ?? null, ok: run ? run.ok : null, note: run?.note ?? null };
    }),
    relay,
    stores: [
      { name: "Receipts", mode: receiptsMode(), durable: receiptsMode() === "postgres" },
      { name: "Tasks and jobs", mode: durableMode(), durable: durableMode() === "postgres" },
      { name: "Shelf", mode: shelfStoreMode(), durable: shelfStoreMode() === "shared" },
      { name: "Checks, delistings and members", mode: database ? "postgres" : "memory", durable: database },
    ],
  };
}
