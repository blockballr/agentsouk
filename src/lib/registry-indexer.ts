import "server-only";

// Our own ERC-8004 indexer: read the identity registry straight from the chain
// over a plain RPC, decode the registration events, resolve each agent's
// registration file, and admit what passes the shelf gate. This is the third
// freshness layer beside the committed snapshot and the 8004scan top up, and
// the first one that does not need a third party's index at all.

import { admitConfirmedAgent, summaryFromRegistration } from "@/lib/scanner";
import type { RegistrationDraft } from "@agora/core";

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const REGISTERED_TOPIC = "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";
const URI_UPDATED_TOPIC = "0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb";

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

function rpcUrl(): string {
  return (
    process.env.REGISTRY_RPC_URL?.trim() ||
    process.env.BSC_RPC_URL?.trim() ||
    "https://bsc-dataseed.bnbchain.org"
  );
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`rpc ${method} answered ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`rpc ${method}: ${body.error.message ?? "error"}`);
  return body.result;
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
  const tokenId = String(BigInt(topics[1] ?? "0x0"));
  if (!/^\d+$/.test(tokenId)) return null;
  const owner = topics[2] ? "0x" + topics[2].slice(-40) : "";
  const agentUri = decodeAbiEventString(log.data ?? "0x");
  const blockNumber = typeof log.blockNumber === "string" ? Number(BigInt(log.blockNumber)) : Number(log.blockNumber ?? 0);
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

// the last block a sync reached, so each run resumes where the previous stopped
let watermark = 0;

export async function registryWatermark(): Promise<number> {
  return watermark;
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
          topics: [[REGISTERED_TOPIC, URI_UPDATED_TOPIC]],
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
    const admission = await admitConfirmedAgent(summary).catch(() => ({ admitted: false, reason: "admission crashed" }));
    if (admission.admitted) admitted += 1;
    else report.refused.push({ tokenId, reason: admission.reason ?? "refused" });
  }
  report.admitted = admitted;
  report.watermark = scannedTo;
  report.toBlock = scannedTo;
  watermark = scannedTo;
  return report;
}
