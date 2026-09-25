import type { Verification } from "@/lib/types";
import { BSC_CHAIN_ID, scoutDirFor, targetChainId } from "@/lib/types";

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
  }[];
}

const CACHE_MS = 30_000;
let cache: { at: number; chain: number; map: Map<string, Verification> } | null = null;
let inflight: Promise<Map<string, Verification>> | null = null;

interface VerificationRow {
  tokenId: string;
  status: Verification["status"];
  responseMs: number;
  checkedAt?: string;
  quality?: Verification["quality"];
  concurrency?: Verification["concurrency"];
}

function asVerification(row: VerificationRow, checkedAt: string | null): Verification | null {
  if (
    row?.tokenId == null ||
    (row.status !== "delivered" && row.status !== "gated" && row.status !== "dead" && row.status !== "unreachable") ||
    typeof row.responseMs !== "number" ||
    typeof checkedAt !== "string"
  ) {
    return null;
  }
  const verification: Verification = {
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
  return verification;
}

async function loadOnce(): Promise<Map<string, Verification>> {
  const chainId = targetChainId();
  if (chainId !== BSC_CHAIN_ID) {
    return loadScoutFile(chainId);
  }
  try {
    const { loadVerificationsFromDb } = await import("./verifications-store");
    const db = await loadVerificationsFromDb();
    if (db.size > 0) return db;
  } catch {
  }

  const byToken = new Map<string, Verification>();
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

async function loadScoutFile(chainId: number): Promise<Map<string, Verification>> {
  const byToken = new Map<string, Verification>();
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

export async function loadVerifications(): Promise<Map<string, Verification>> {
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
