// server-only: the passports issued, one per wallet, numbered in the order they were issued.
// The number ties a shared card back to the wallet that earned it, and the evidence kept
// beside it is what the passport rested on at that moment. With no database they live in
// process memory

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

// reading a passport is never worth holding the page for
const CAP_MS = 4000;

// the passport of a wallet that has completed the quest: issued on the first call, and the same
// one on every call after. Null when it cannot be read or written, and the caller carries on
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
    // the next number is one past the highest. Two wallets finishing together collide on the
    // unique number, and the one that lost tries again
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

export function resetPassportsForTests(): void {
  memory.clear();
}
