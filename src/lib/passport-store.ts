// server-only: one passport per wallet, numbered in the order issued, with the evidence it
// rested on. With no database they live in process memory

import "server-only";
import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

export interface Passport {
  wallet: string;
  number: number;
  issuedAt: string;
}

const memory = new Map<string, Passport>();
let tableReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists passports (
          wallet text primary key,
          number integer not null unique,
          issued_at timestamptz not null default now(),
          evidence jsonb
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

const CAP_MS = 4000;

// issued on the first call and the same one after; null when it cannot be read or written
export function issuePassport(wallet: string, evidence: unknown): Promise<Passport | null> {
  const w = wallet.toLowerCase();
  if (!sql) {
    const held = memory.get(w) ?? { wallet: w, number: memory.size + 1, issuedAt: new Date().toISOString() };
    memory.set(w, held);
    return Promise.resolve(held);
  }
  const db = sql;
  const work = (async (): Promise<Passport | null> => {
    if (!(await ensureTable())) return null;
    // two wallets finishing together collide on the unique number, and the loser tries again
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await db`
          insert into passports (wallet, number, evidence)
          select ${w}, coalesce(max(number), 0) + 1, ${JSON.stringify(evidence ?? null)}::jsonb from passports
          on conflict (wallet) do nothing
        `;
      } catch (e) {
        if (!/unique|duplicate/i.test(e instanceof Error ? e.message : String(e))) throw e;
        continue;
      }
      const rows = (await db`select number, issued_at from passports where wallet = ${w}`) as {
        number: number;
        issued_at: Date | string;
      }[];
      if (rows[0]) return { wallet: w, number: Number(rows[0].number), issuedAt: new Date(rows[0].issued_at).toISOString() };
    }
    return null;
  })().catch((e) => {
    console.error("[passport] not issued", w, e instanceof Error ? e.message : String(e));
    return null;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), CAP_MS);
  });
  return Promise.race([work, cap]).finally(() => clearTimeout(timer));
}

export async function countPassports(): Promise<number | null> {
  if (!sql) return memory.size;
  try {
    if (!(await ensureTable())) return null;
    const rows = (await sql`select count(*)::int as n from passports`) as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

export function resetPassportsForTests(): void {
  memory.clear();
}
