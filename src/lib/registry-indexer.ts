import "server-only";

// Our own ERC-8004 indexer: read the identity and reputation registries
// straight from the chain over a plain RPC, decode their events, resolve each
// agent's registration file, and admit or refresh through the shelf gate.
// This is the third freshness layer beside the committed snapshot and the
// 8004scan top up, and the first one that does not need a third party's index
// at all.

import { readPipelineState, writePipelineState } from "@/lib/history-store";
import { admitConfirmedAgent, getAgentByToken, summaryFromRegistration } from "@/lib/scanner";
import type { RegistrationDraft } from "@agora/core";

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const REPUTATION = "0x8004baa17c55a88189ae136b182e5fda19de9b63";
const REGISTERED_TOPIC = "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";
const URI_UPDATED_TOPIC = "0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const NEW_FEEDBACK_TOPIC = "0x8f29270f75034746f3726ef4d92262b2d08262b23f6b092d81850d5ad74cef09";

export interface RegistryEvent {
  tokenId: string;
  agentUri: string;
  owner: string;
  blockNumber: number;
  txHash: string;
}

export interface RegistrySyncReport {
  fromBlock: number;
  toBlock: number;
  scannedBlocks: number;
  events: number;
  resolutionFailures: number;
  admitted: number;
  refused: { tokenId: string; reason: string }[];
  watermark: number;
  error?: string;
}

// the bnbchain seed nodes refuse filtered getLogs outright, so the provider
// list leads with one that answers; an explicit env still wins when set
const PROVIDERS = [
  process.env.REGISTRY_RPC_URL?.trim() || process.env.BSC_RPC_URL?.trim() || "",
  "https://bsc.publicnode.com",
  "https://bsc-dataseed.bnbchain.org",
].filter(Boolean);

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  let lastError: Error | null = null;
  for (const url of PROVIDERS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`rpc ${method} answered ${res.status}`);
      const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) throw new Error(`rpc ${method}: ${body.error.message ?? "error"}`);
      return body.result;
    } catch (e) {
      lastError = e as Error;
    }
  }
  throw lastError ?? new Error(`rpc ${method} had no provider`);
}

// a registered or uri-updated event carries one dynamic string; the abi word
// layout is offset, length, bytes, which is a three-line decode
export function decodeAbiEventString(hex: string): string {
  const clean = hex.replace(/^0x/, "");
  if (clean.length < 64 + 64) return "";
  const offset = Number(BigInt("0x" + clean.slice(0, 64)));
  if (offset + 64 > clean.length) return "";
  const length = Number(BigInt("0x" + clean.slice(offset * 2, offset * 2 + 64)));
  if (length <= 0 || offset * 2 + 64 + length * 2 > clean.length) return "";
  const value = clean.slice(offset * 2 + 64, offset * 2 + 64 + length * 2);
  return Buffer.from(value, "hex").toString("utf8");
}

function decodeLog(log: { data?: string; topics?: string[]; blockNumber?: string|number; transactionHash?: string }): RegistryEvent | null {
  const topics = log.topics ?? [];
  if (topics.length < 2) return null;
  const blockNumber = typeof log.blockNumber === "string" ? Number(BigInt(log.blockNumber)) : Number(log.blockNumber ?? 0);
  // a transfer moves the agent differently: token id in topic3, no uri at all
  if (topics[0] === TRANSFER_TOPIC) {
    if (topics.length < 4) return null;
    const tokenId = String(BigInt(topics[3] ?? "0x0"));
    if (!/^\d+$/.test(tokenId)) return null;
    const owner = topics[2] ? "0x" + topics[2].slice(-40) : "";
    return { tokenId, agentUri: "", owner, blockNumber, txHash: log.transactionHash ?? "" };
  }
  const tokenId = String(BigInt(topics[1] ?? "0x0"));
  if (!/^\d+$/.test(tokenId)) return null;
  const owner = topics[2] ? "0x" + topics[2].slice(-40) : "";
  const agentUri = decodeAbiEventString(log.data ?? "0x");
  return { tokenId, agentUri, owner, blockNumber, txHash: log.transactionHash ?? "" };
}

export async function resolveRegistrationFile(uri: string): Promise<Record<string, unknown> | null> {
  const clean = uri.trim();
  if (!clean) return null;
  try {
    if (clean.startsWith("data:")) {
      const base64 = clean.split("base64,")[1] ?? "";
      return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    }
    let url = clean;
    if (clean.startsWith("ipfs://")) {
      const gateway = process.env.REGISTRY_IPFS_GATEWAY?.trim() || "https://ipfs.io/ipfs/";
      url = gateway + clean.replace(/^ipfs:\/\//, "");
    }
    if (!/^https:\/\//i.test(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// The registration file is the agent's own card: name, description, image and
// named services. The service names decide the protocol chips exactly the way
// the wizard's import path does, so one reading governs both.
export function draftFromRegistrationFile(file: Record<string, unknown>): {
  name: string;
  description: string;
  image: string;
  x402Support: boolean;
  endpoint: string;
  endpointKinds: ("A2A" | "MCP" | "web")[];
} {
  const services = Array.isArray(file.services) ? file.services : [];
  const kinds: ("A2A" | "MCP" | "web")[] = [];
  let endpoint = "";
  let mcpUrl = "";
  for (const raw of services) {
    const service = (raw ?? {}) as { name?: unknown; url?: unknown };
    const name = String(service.name ?? "").toLowerCase();
    const url = String(service.url ?? "").trim();
    if (!url) continue;
    if (name.includes("a2a") || name.includes("agent2agent")) {
      if (!endpoint) endpoint = url;
      if (!kinds.includes("A2A")) kinds.push("A2A");
    } else if (name.includes("mcp")) {
      mcpUrl = url;
      if (!kinds.includes("MCP")) kinds.push("MCP");
    } else if (name.includes("web")) {
      if (!kinds.includes("web")) kinds.push("web");
    } else if (!endpoint) {
      endpoint = url;
      if (!kinds.includes("A2A")) kinds.push("A2A");
    }
  }
  const fallback = String(file.agentURI ?? file.uri ?? "").trim();
  if (!endpoint && !mcpUrl && fallback) {
    endpoint = fallback;
    if (!kinds.includes("A2A")) kinds.push("A2A");
  }
  return {
    name: String(file.name ?? "").trim(),
    description: String(file.description ?? "").trim(),
    image: String(file.image ?? "").trim(),
    x402Support: file.x402Support === undefined ? true : Boolean(file.x402Support),
    endpoint: endpoint || mcpUrl,
    endpointKinds: kinds.length ? kinds : ["A2A"],
  };
}

async function blockTimestamp(blockNumber: number): Promise<string> {
  try {
    const hex = await rpc("eth_getBlockByNumber", ["0x" + blockNumber.toString(16), false]);
    const timestamp = Number(BigInt((hex as { timestamp?: string } | null)?.timestamp ?? "0x0"));
    return timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// the last block a sync reached. process memory answers immediately while the
// fleet's durable state answers after a restart, so cold cron pods resume
// where the pipeline left off instead of rescanning the same window
let watermark = 0;
let watermarkLoaded = false;
const WATERMARK_KEY = "registrySyncWatermark";
const REPUTATION_WATERMARK_KEY = "reputationSyncWatermark";

async function loadWatermark(key: string): Promise<number> {
  const stored = await readPipelineState(key).catch(() => null);
  const value = stored ? Number(stored) : 0;
  return Number.isInteger(value) && value > 0 ? value : 0;
}

async function saveWatermark(key: string, block: number): Promise<void> {
  await writePipelineState(key, String(block)).catch(() => undefined);
}

export async function registryWatermark(): Promise<number> {
  return watermark;
}

// the registry's reserved agentWallet key answers exactly one question: where
// the money for a hire lands. owner_address stays the fallback for the same
// reason the 8004scan path needs one
const GET_METADATA_SELECTOR = "0xcb4799f2";
const AGENT_WALLET_KEY_HEX = Buffer.from("agentWallet", "utf8").toString("hex");

export async function readAgentWallet(agentId: string): Promise<string | null> {
  const padded = BigInt(agentId).toString(16).padStart(64, "0");
  const offset = "40".padStart(64, "0");
  const length = "0b".padStart(64, "0");
  const data = "0x" + GET_METADATA_SELECTOR.slice(2) + padded + offset + length + AGENT_WALLET_KEY_HEX.padEnd(64, "0");
  try {
    const result = await rpc("eth_call", [{ to: REGISTRY, data }, "latest"]) as string | null;
    const hex = (result ?? "").replace(/^0x/, "");
    // bytes return: the address sits in the last of the first value word
    if (hex.length >= 192) {
      const value = hex.slice(128, 320).replace(/0+$/, "");
      if (value.length >= 40) {
        const address = "0x" + value.slice(-40);
        return /^0x[0-9a-fA-F]{40}$/.test(address) && BigInt(address) !== 0n ? address.toLowerCase() : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// an ownership transfer re-points a shelf token; the registry clears the
// reserved wallet at the same moment, so the owner alone is refreshed here
type AgentSummaryLike = Parameters<typeof admitConfirmedAgent>[0];

export async function refreshShelfOwner(tokenId: string, newOwner: string): Promise<boolean> {
  const existing = (await getAgentByToken(56, tokenId).catch(() => null)) as AgentSummaryLike | null;
  if (!existing) return false;
  if (!("owner_address" in existing) || existing.owner_address === newOwner) return false;
  const updated = { ...existing, owner_address: newOwner.toLowerCase() };
  const admission = await admitConfirmedAgent(updated as Parameters<typeof admitConfirmedAgent>[0]).catch(() => null);
  return Boolean(admission?.admitted);
}

export async function syncRegistryFromChain(options: {
  maxBlocks?: number;
  maxAgents?: number;
  watermarkOverride?: number;
} = {}): Promise<RegistrySyncReport> {
  const maxBlocks = Math.max(200, Math.min(options.maxBlocks ?? 2_000, 30_000));
  const maxAgents = Math.max(1, Math.min(options.maxAgents ?? 10, 30));
  const latestHex = await rpc("eth_blockNumber", []);
  const latest = Number(BigInt(String(latestHex)));
  const head = Math.max(latest - 12, 0);
  if (!watermarkLoaded) {
    watermark = await loadWatermark(WATERMARK_KEY);
    watermarkLoaded = true;
  }
  const buffered = watermark > 0 ? Math.max(watermark - 120, 0) : head - maxBlocks;
  const fromBlock = Math.max(options.watermarkOverride ?? buffered, 0);
  if (fromBlock >= head) {
    return {
      fromBlock,
      toBlock: head,
      scannedBlocks: 0,
      events: 0,
      resolutionFailures: 0,
      admitted: 0,
      refused: [],
      watermark: head,
    };
  }

  const report: RegistrySyncReport = {
    fromBlock,
    toBlock: head,
    scannedBlocks: head - fromBlock,
    events: 0,
    resolutionFailures: 0,
    admitted: 0,
    refused: [],
    watermark: head,
  };

  // public endpoints cap the getLogs range and result size, so the window is
  // walked in small slices; the watermark keeps the coverage continuous even
  // when a slice fails mid-run
  const slice = 400;
  const logs: Array<{ data?: string; topics?: string[]; blockNumber?: string; transactionHash?: string; removed?: boolean }> = [];
  let scannedTo = fromBlock;
  for (let lo = fromBlock; lo <= head; lo += slice) {
    const hi = Math.min(lo + slice - 1, head);
    try {
      const raw = (await rpc("eth_getLogs", [
        {
          fromBlock: "0x" + lo.toString(16),
          toBlock: "0x" + hi.toString(16),
          address: REGISTRY,
          topics: [[REGISTERED_TOPIC, URI_UPDATED_TOPIC, TRANSFER_TOPIC]],
        },
      ])) as typeof logs;
      for (const l of raw ?? []) if (!l.removed) logs.push(l);
      scannedTo = hi;
      report.scannedBlocks = scannedTo - fromBlock;
    } catch (e) {
      if (scannedTo > fromBlock) {
        // resume from the last full slice on the next run instead of failing all
        report.watermark = scannedTo;
        report.toBlock = scannedTo;
        report.error = `resumed at block ${lo}: ${(e as Error).message}`;
        break;
      }
      report.error = (e as Error).message;
      return report;
    }
  }
  report.events = logs.length;

  // later events win: a uri update after a register re-reads the file
  const byToken = new Map<string, RegistryEvent>();
  for (const log of logs) {
    const event = decodeLog(log);
    if (!event) continue;
    const existing = byToken.get(event.tokenId);
    if (!existing || event.blockNumber >= existing.blockNumber) byToken.set(event.tokenId, event);
  }

  // a transfer never re-mints, so a moved token carries no uri: re-point the
  // shelf token's owner instead, and skip full re-derivation for it
  const transfers = new Map<string, string>();
  for (const log of logs) {
    const topics = log.topics ?? [];
    if (topics[0] !== TRANSFER_TOPIC || topics.length < 4) continue;
    const from = "0x" + topics[1].slice(-40);
    if (BigInt(from) === 0n) continue;
    const to = "0x" + topics[2].slice(-40);
    const tokenId = String(BigInt(topics[3]));
    transfers.set(tokenId, to.toLowerCase());
    byToken.delete(tokenId);
  }

  const ownersRefreshed: string[] = [];
  for (const [tokenId, owner] of transfers) {
    const moved = await refreshShelfOwner(tokenId, owner);
    if (moved) ownersRefreshed.push(tokenId);
    // the dry store is authoritative on registration events, so a transfer of
    // an unknown token is left to the heartbeat that sweeps the frontend shelf
  }

  let admitted = 0;
  for (const [tokenId, event] of byToken) {
    if (admitted >= maxAgents) break;
    const file = await resolveRegistrationFile(event.agentUri);
    if (!file) {
      report.resolutionFailures += 1;
      continue;
    }
    const owner = event.owner && /^0x[0-9a-fA-F]{40}$/.test(event.owner) ? event.owner.toLowerCase() : "";
    if (!owner) continue;
    const created = await blockTimestamp(event.blockNumber);
    const draft: RegistrationDraft = {
      ...draftFromRegistrationFile(file),
      category: "",
    };
    const summary = summaryFromRegistration({
      chainId: 56,
      tokenId,
      owner,
      registry: REGISTRY,
      draft,
      createdAt: created,
    });
    // the reserved on-chain wallet outranks the owner as the receiving address
    const wallet = await readAgentWallet(tokenId);
    if (wallet) (summary as { agent_wallet?: string | null }).agent_wallet = wallet;
    const admission = await admitConfirmedAgent(summary).catch(() => ({ admitted: false, reason: "admission crashed" }));
    if (admission.admitted) admitted += 1;
    else report.refused.push({ tokenId, reason: admission.reason ?? "refused" });
  }
  report.admitted = admitted;
  report.watermark = scannedTo;
  report.toBlock = scannedTo;
  watermark = scannedTo;
  await saveWatermark(WATERMARK_KEY, scannedTo);
  return report;
}

// the reputation leg: decode the v2.0.0 reputation registry's events the same
// way, then re-read the scored totals straight from the chain for every shelf
// token whose feedback moved. stateless recompute, so revocations and the
// attendance of third-party feedback land on their next event
export interface ReputationSyncReport {
  fromBlock: number;
  toBlock: number;
  events: number;
  shelfTokensUpdated: string[];
  failures: number;
  error?: string;
}

const STATUS_LEDGER_ABI = [
  {
    type: "function",
    name: "getClients",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "readAllFeedback",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "includeRevoked", type: "bool" },
    ],
    outputs: [
      { name: "clients", type: "address[]" },
      { name: "feedbackIndexes", type: "uint64[]" },
      { name: "values", type: "int128[]" },
      { name: "valueDecimals", type: "uint8[]" },
      { name: "tags1", type: "string[]" },
      { name: "tags2", type: "string[]" },
      { name: "revokedFlags", type: "bool[]" },
    ],
  },
] as const;

interface StarredTotals {
  count: number;
  mean: number | null;
}

async function readStarredTotals(tokenId: string): Promise<StarredTotals | null> {
  const viem = await import("viem");
  try {
    const call = async (abi: (typeof STATUS_LEDGER_ABI)[number], args: unknown[]): Promise<unknown> => {
      const data = viem.encodeFunctionData({
        abi: [abi],
        functionName: abi.name as never,
        args: args as never,
      });
      const result = await rpc("eth_call", [{ to: REPUTATION, data }, "latest"]);
      return viem.decodeFunctionResult({
        abi: [abi],
        functionName: abi.name as never,
        data: (result ?? "0x") as `0x${string}`,
      });
    };
    const clients = (await call(STATUS_LEDGER_ABI[0], [BigInt(tokenId)])) as string[];
    if (!Array.isArray(clients)) return null;
    const batch = (await call(STATUS_LEDGER_ABI[1], [BigInt(tokenId), clients, "starred", true])) as {
      values?: bigint[];
      valueDecimals?: number[];
      revokedFlags?: boolean[];
    };
    if (!Array.isArray(batch?.values)) return null;
    let count = 0;
    let sum = 0;
    for (let i = 0; i < batch.values.length; i++) {
      if (batch.revokedFlags?.[i]) continue;
      count += 1;
      const decimals = Number(batch.valueDecimals?.[i] ?? 0);
      sum += Number(batch.values[i]) / 10 ** Math.min(decimals, 18);
    }
    return { count, mean: count > 0 ? Math.round((sum / count) * 100) / 100 : null };
  } catch {
    return null;
  }
}

async function applyReputationTotals(tokenId: string, totalFeedbacks: number, mean: number | null): Promise<boolean> {
  const existing = (await getAgentByToken(56, tokenId).catch(() => null)) as AgentSummaryLike | null;
  if (!existing || !("total_feedbacks" in existing)) return false;
  if ((existing.total_feedbacks ?? 0) === totalFeedbacks && (mean === null || existing.average_score === mean)) {
    return false;
  }
  const updated = {
    ...existing,
    total_feedbacks: totalFeedbacks,
    ...(mean !== null ? { average_score: mean } : {}),
  };
  const admission = await admitConfirmedAgent(updated as Parameters<typeof admitConfirmedAgent>[0]).catch(() => null);
  return Boolean(admission?.admitted);
}

export async function syncReputationFromChain(options: { maxBlocks?: number } = {}): Promise<ReputationSyncReport> {
  const maxBlocks = Math.max(200, Math.min(options.maxBlocks ?? 2_000, 30_000));
  const latestHex = await rpc("eth_blockNumber", []);
  const latest = Number(BigInt(String(latestHex)));
  const head = Math.max(latest - 12, 0);
  const stored = await loadWatermark(REPUTATION_WATERMARK_KEY);
  const buffered = stored > 0 ? Math.max(stored - 120, 0) : head - maxBlocks;
  const fromBlock = Math.max(buffered, 0);

  const report: ReputationSyncReport = {
    fromBlock,
    toBlock: head,
    events: 0,
    shelfTokensUpdated: [],
    failures: 0,
  };
  if (fromBlock >= head) return report;

  const slice = 400;
  const touched = new Set<string>();
  let scannedTo = fromBlock;
  let hardError: string | undefined;
  for (let lo = fromBlock; lo <= head; lo += slice) {
    const hi = Math.min(lo + slice - 1, head);
    try {
      const raw = (await rpc("eth_getLogs", [
        {
          fromBlock: "0x" + lo.toString(16),
          toBlock: "0x" + hi.toString(16),
          address: REPUTATION,
          topics: [[NEW_FEEDBACK_TOPIC]],
        },
      ])) as Array<{ removed?: boolean }>;
      const count = (raw ?? []).filter((l) => !l.removed).length;
      report.events += count;
      for (const l of (raw ?? []) as Array<{ topics?: string[] }>) {
        const agentTopic = l.topics?.[1];
        if (!agentTopic) continue;
        // topic1 is the indexed agentId, so the event names its shelf token itself
        touched.add(String(BigInt(agentTopic)));
      }
      scannedTo = hi;
    } catch (e) {
      if (scannedTo > fromBlock) {
        report.error = `resumed at block ${lo}: ${(e as Error).message}`;
        hardError = report.error;
        break;
      }
      report.error = (e as Error).message;
      return report;
    }
  }

  for (const tokenId of touched) {
    const totals = await readStarredTotals(tokenId);
    if (!totals) {
      report.failures += 1;
      continue;
    }
    const touchedShelf = await applyReputationTotals(tokenId, totals.count, totals.mean);
    if (touchedShelf) report.shelfTokensUpdated.push(tokenId);
  }

  report.toBlock = hardError ? scannedTo : head;
  await saveWatermark(REPUTATION_WATERMARK_KEY, report.toBlock);
  return report;
}
