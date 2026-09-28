import type { Verification } from "./types";
import { BSC_CHAIN_ID, scoutDirFor, targetChainId } from "./types";
import { privateEndpointReason } from "./endpoint";

// a recorded verification, plus the plain reason behind a refusal so an
// auditor sees why the endpoint could not be reached
export interface RecordedVerification extends Verification {
  detail?: string;
}

interface VerificationsFile {
  updatedAt: string;
  results: {
    tokenId: string;
    name: string;
    category: string;
    status: Verification["status"];
    responseMs: number;
    checkedAt: string;
    quality?: Verification["quality"];
    concurrency?: Verification["concurrency"];
    detail?: string;
  }[];
}

// An agent can name a loopback or private address as the url the marketplace
// should call. A delivery that fails for that reason is the agent's endpoint
// being unreachable, not the agent being dead, so the sweep records it that way.
// The reason is embedded verbatim, which keeps a quoted non-url in some other
// agent error from being mistaken for the endpoint.
export function endpointFailureReason(error: unknown): string | null {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  if (!text) return null;
  const url = text.match(/^"([^"]+)"/)?.[1];
  if (!url) return null;
  const reason = privateEndpointReason(url);
  return reason && text.includes(reason) ? text : null;
}

export function unreachableEndpointVerdict(
  error: unknown,
): { status: "unreachable"; detail: string } | null {
  const detail = endpointFailureReason(error);
  return detail ? { status: "unreachable", detail } : null;
}

const CACHE_MS = 30_000;
let cache: { at: number; chain: number; map: Map<string, RecordedVerification> } | null = null;
let inflight: Promise<Map<string, RecordedVerification>> | null = null;

interface VerificationRow {
  tokenId: string;
  status: Verification["status"];
  responseMs: number;
  checkedAt?: string;
  quality?: Verification["quality"];
  concurrency?: Verification["concurrency"];
  detail?: string;
}

function asVerification(row: VerificationRow, checkedAt: string | null): RecordedVerification | null {
  if (
    row?.tokenId == null ||
    (row.status !== "delivered" && row.status !== "gated" && row.status !== "dead" && row.status !== "unreachable") ||
    typeof row.responseMs !== "number" ||
    typeof checkedAt !== "string"
  ) {
    return null;
  }
  const verification: RecordedVerification = {
    status: row.status,
    responseMs: row.responseMs,
    checkedAt,
  };
  if (
    row.quality &&
    (row.quality.grade === "good" || row.quality.grade === "partial" || row.quality.grade === "poor") &&
    typeof row.quality.reason === "string" &&
    typeof row.quality.model === "string"
  ) {
    verification.quality = {
      grade: row.quality.grade,
      reason: row.quality.reason,
      model: row.quality.model,
    };
  }
  if (
    row.concurrency === "parallel-ok" ||
    row.concurrency === "single-ok" ||
    row.concurrency === "untested"
  ) {
    verification.concurrency = row.concurrency;
  }
  if (typeof row.detail === "string") {
    verification.detail = row.detail;
  }
  return verification;
}

async function loadMainnetFile(): Promise<Map<string, RecordedVerification>> {
  const byToken = new Map<string, RecordedVerification>();
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "data", "verifications.json");
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as VerificationsFile;
    for (const r of parsed.results ?? []) {
      const verification = asVerification(r, r.checkedAt);
      if (verification) byToken.set(String(r.tokenId), verification);
    }
  } catch {
  }
  return byToken;
}

async function loadOnce(): Promise<Map<string, RecordedVerification>> {
  const chainId = targetChainId();
  // read the durable store on every chain; the per-chain file is the fallback
  const byToken =
    chainId === BSC_CHAIN_ID ? await loadMainnetFile() : await loadScoutFile(chainId);

  try {
    const { loadVerificationsFromDb } = await import("./verifications-store");
    const db = await loadVerificationsFromDb();
    for (const [tokenId, v] of db) {
      byToken.set(tokenId, v);
    }
  } catch {
  }

  return byToken;
}

async function loadScoutFile(chainId: number): Promise<Map<string, RecordedVerification>> {
  const byToken = new Map<string, RecordedVerification>();
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "data", scoutDirFor(chainId), "verifications.json");
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as {
      updatedAt?: string;
      results?: VerificationRow[];
    };
    const fallbackCheckedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
    for (const r of parsed.results ?? []) {
      const checkedAt = typeof r.checkedAt === "string" ? r.checkedAt : fallbackCheckedAt;
      const verification = asVerification(r, checkedAt);
      if (verification) byToken.set(String(r.tokenId), verification);
    }
  } catch {
  }
  return byToken;
}

export async function loadVerifications(): Promise<Map<string, RecordedVerification>> {
  const chain = targetChainId();
  if (cache && cache.chain === chain && Date.now() - cache.at < CACHE_MS) return cache.map;
  if (inflight) return inflight;
  inflight = loadOnce()
    .then((map) => {
      cache = { at: Date.now(), chain, map };
      return map;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
