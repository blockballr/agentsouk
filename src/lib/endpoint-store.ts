// server-only seeded a2a endpoints, kept durably so a shelf rebuild re-applies
// them instead of discarding the only copy. With no database the map lives in
// process memory, exactly as the delist store does, so a missing store degrades
// instead of throwing.

import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  pickSeededEndpoints,
  seededKey,
  type SeededEndpointKey,
  type SeededEndpointRow,
} from "./seeded-endpoints";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

const memory = new Map<SeededEndpointKey, SeededEndpointRow>();
let tableReady: Promise<boolean> | null = null;
let sidecarRead: Promise<void> | null = null;

// Without a database the durable copy is a committed sidecar, so a rebuild keeps
// the endpoints an operator published and a reviewer can see every change to them
// in a diff. It is read once per process and is never written at runtime.
const SIDECAR = path.join("data", "seeded-endpoints.json");

function loadSidecar(): Promise<void> {
  if (sidecarRead) return sidecarRead;
  sidecarRead = (async () => {
    try {
      const raw = await readFile(path.join(process.cwd(), SIDECAR), "utf8");
      const parsed = JSON.parse(raw) as { entries?: Partial<SeededEndpointRow>[] };
      for (const e of parsed.entries ?? []) {
        const chainId = Number(e.chainId);
        const tokenId = typeof e.tokenId === "string" ? e.tokenId : "";
        const a2aEndpoint = typeof e.a2aEndpoint === "string" ? e.a2aEndpoint : "";
        // a seed is an operator's own published https card and nothing else, so a
        // malformed row is dropped rather than trusted
        if (!Number.isSafeInteger(chainId) || chainId < 1) continue;
        if (!/^\d{1,78}$/.test(tokenId)) continue;
        if (!/^https:\/\/\S+$/.test(a2aEndpoint)) continue;
        memory.set(seededKey(chainId, tokenId), {
          chainId,
          tokenId,
          a2aEndpoint,
          source: typeof e.source === "string" ? e.source : null,
        });
      }
    } catch {
      // a missing sidecar is the common case, not a fault
    }
  })();
  return sidecarRead;
}

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists seeded_endpoints (
          chain_id integer not null,
          token_id text not null,
          a2a_endpoint text not null,
          source text,
          seeded_at timestamptz not null default now(),
          primary key (chain_id, token_id)
        )
      `;
      return true;
    } catch {
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

export async function loadSeededEndpoints(): Promise<Map<SeededEndpointKey, SeededEndpointRow>> {
  await loadSidecar();
  let dbRows: SeededEndpointRow[] | null = null;
  if ((await ensureTable()) && sql) {
    try {
      const rows = (await sql`
        select chain_id, token_id, a2a_endpoint, source from seeded_endpoints
      `) as {
        chain_id: number;
        token_id: string;
        a2a_endpoint: string;
        source: string | null;
      }[];
      dbRows = rows.map((r) => ({
        chainId: Number(r.chain_id),
        tokenId: String(r.token_id),
        a2aEndpoint: r.a2a_endpoint,
        source: r.source ?? null,
      }));
      // keep the fallback in step, so a later failed read serves what the database last said
      memory.clear();
      for (const r of dbRows) memory.set(seededKey(r.chainId, r.tokenId), r);
    } catch {
    }
  }
  return pickSeededEndpoints(dbRows, memory);
}

// Records one listing's published endpoint. The endpoint is always an address the
// operator itself published on its own card, so a later rebuild re-derives the same
// answer rather than trusting a value this marketplace invented.
export async function seedEndpoint(
  chainId: number,
  tokenId: string,
  a2aEndpoint: string,
  source?: string,
): Promise<boolean> {
  const row: SeededEndpointRow = {
    chainId,
    tokenId,
    a2aEndpoint,
    source: source ?? null,
  };
  if ((await ensureTable()) && sql) {
    try {
      await sql`
        insert into seeded_endpoints (chain_id, token_id, a2a_endpoint, source)
        values (${chainId}, ${tokenId}, ${a2aEndpoint}, ${source ?? null})
        on conflict (chain_id, token_id) do update
          set a2a_endpoint = excluded.a2a_endpoint,
              source = excluded.source,
              seeded_at = now()
      `;
    } catch {
      return false;
    }
  }
  // the sidecar first, so a runtime seed is not clobbered by a load that lands later
  await loadSidecar();
  // after the write, so a failed write does not leave memory saying otherwise
  memory.set(seededKey(chainId, tokenId), row);
  return true;
}

export async function clearEndpoint(chainId: number, tokenId: string): Promise<boolean> {
  await loadSidecar();
  if ((await ensureTable()) && sql) {
    try {
      await sql`delete from seeded_endpoints where chain_id = ${chainId} and token_id = ${tokenId}`;
    } catch {
      return false;
    }
  }
  memory.delete(seededKey(chainId, tokenId));
  return true;
}
