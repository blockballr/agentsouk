// server-only store for what owners changed about their listings. The database is the truth
// whenever it answers; with no database the edits live in process memory, so a missing store
// degrades instead of throwing

import "server-only";
import postgres from "postgres";
import { cached, invalidate } from "./short-cache";
import type { ListingEdit, ListingExample, StoredListingEdit } from "./listing-edit";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

const memory = new Map<string, StoredListingEdit>();
let tableReady: Promise<boolean> | null = null;

// every browse reads the edits, so one read is shared for a few seconds
const CACHE_KEY = "listing-edits";
const CACHE_MS = 15_000;

export function editKey(chainId: number, tokenId: string): string {
  return `${chainId}:${tokenId}`;
}

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists listing_edits (
          chain_id integer not null,
          token_id text not null,
          description text,
          examples jsonb not null default '[]'::jsonb,
          image_url text,
          updated_by text not null,
          updated_at timestamptz not null,
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

function readExamples(value: unknown): ListingExample[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((e) =>
    e && typeof e === "object" && typeof (e as ListingExample).task === "string"
      ? [{ task: (e as ListingExample).task, input: typeof (e as ListingExample).input === "string" ? (e as ListingExample).input : null }]
      : [],
  );
}

async function readAll(): Promise<Map<string, StoredListingEdit>> {
  if ((await ensureTable()) && sql) {
    try {
      const rows = (await sql`
        select chain_id, token_id, description, examples, image_url, updated_at from listing_edits
      `) as {
        chain_id: number;
        token_id: string;
        description: string | null;
        examples: unknown;
        image_url: string | null;
        updated_at: Date | string;
      }[];
      const fresh = new Map<string, StoredListingEdit>();
      for (const r of rows) {
        fresh.set(editKey(Number(r.chain_id), String(r.token_id)), {
          description: r.description ?? null,
          examples: readExamples(r.examples),
          imageUrl: r.image_url ?? null,
          updatedAt: new Date(r.updated_at).toISOString(),
        });
      }
      // keep the fallback in step, so a later failed read serves what the database last said
      memory.clear();
      for (const [k, v] of fresh) memory.set(k, v);
      return fresh;
    } catch {
      // fall through to what this process last knew
    }
  }
  return new Map(memory);
}

export function loadListingEdits(): Promise<Map<string, StoredListingEdit>> {
  return cached(CACHE_KEY, CACHE_MS, readAll);
}

// the one edit a write has to compare against, read past the cache
export async function loadListingEdit(chainId: number, tokenId: string): Promise<StoredListingEdit | undefined> {
  return (await readAll()).get(editKey(chainId, tokenId));
}

// stores the edit, an emptied one included; false means it was not persisted
export async function saveListingEdit(
  chainId: number,
  tokenId: string,
  edit: ListingEdit,
  updatedBy: string,
  updatedAt: string,
): Promise<boolean> {
  if ((await ensureTable()) && sql) {
    try {
      await sql`
        insert into listing_edits (chain_id, token_id, description, examples, image_url, updated_by, updated_at)
        values (
          ${chainId}, ${tokenId}, ${edit.description}, ${JSON.stringify(edit.examples)}::jsonb,
          ${edit.imageUrl}, ${updatedBy.toLowerCase()}, ${updatedAt}
        )
        on conflict (chain_id, token_id) do update set
          description = excluded.description,
          examples = excluded.examples,
          image_url = excluded.image_url,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `;
    } catch {
      return false;
    }
  }
  // after the write, so a failed write does not leave memory saying otherwise
  memory.set(editKey(chainId, tokenId), { ...edit, updatedAt });
  invalidate(CACHE_KEY);
  return true;
}

export function resetListingEditsForTests(): void {
  memory.clear();
  invalidate(CACHE_KEY);
}
