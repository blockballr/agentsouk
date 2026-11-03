// server-only store for authority declarations, written at registration and on
// a signed update. No database means memory; a configured database is the truth,
// and a write it cannot take is refused rather than answered as saved.

import "server-only";
import postgres from "postgres";
import { cached, invalidate } from "./short-cache";
import type { AuthorityDeclaration, StoredDeclaration } from "./authority-declaration";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

const memory = new Map<string, StoredDeclaration>();
let tableReady: Promise<boolean> | null = null;

const CACHE_MS = 15_000;

export function declarationKey(chainId: number, tokenId: string): string {
  return `${chainId}:${tokenId}`;
}

export function claimKey(claimId: string): string {
  return `claim:${claimId}`;
}

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists authority_declarations (
          listing_key text primary key,
          declaration jsonb not null,
          updated_by text not null,
          updated_at timestamptz not null
        )
      `;
      return true;
    } catch {
      return false;
    }
  })();
  return tableReady;
}

export async function loadDeclaration(key: string): Promise<StoredDeclaration | null> {
  const row = await cached(`authority:${key}`, CACHE_MS, async (): Promise<StoredDeclaration | null> => {
    if (sql && (await ensureTable())) {
      try {
        const rows = await sql!<{ declaration: AuthorityDeclaration; updated_by: string; updated_at: string }[]>`
          select declaration, updated_by, updated_at from authority_declarations where listing_key = ${key} limit 1
        `;
        if (rows.length === 0) return null;
        const r = rows[0];
        return { ...r.declaration, updatedBy: r.updated_by, updatedAt: new Date(r.updated_at).toISOString() };
      } catch {
        return memory.get(key) ?? null;
      }
    }
    return memory.get(key) ?? null;
  });
  return row;
}

export async function saveDeclaration(
  key: string,
  declaration: AuthorityDeclaration,
  updatedBy: string,
): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  if (sql) {
    if (!(await ensureTable())) return false;
    try {
      await sql!`
        insert into authority_declarations (listing_key, declaration, updated_by, updated_at)
        values (${key}, ${JSON.stringify(declaration)}::jsonb, ${updatedBy.toLowerCase()}, ${updatedAt})
        on conflict (listing_key) do update set
          declaration = excluded.declaration,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `;
    } catch {
      return false;
    }
  }
  memory.set(key, { ...declaration, updatedBy: updatedBy.toLowerCase(), updatedAt });
  invalidate(`authority:${key}`);
  return true;
}
