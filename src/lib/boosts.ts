// paid listing boost: temporary sort priority on the marketplace
// memory + optional postgres; x402 settlement is the payment proof

import "server-only";
import postgres from "postgres";

export interface Boost {
  id: string;
  chainId: number;
  tokenId: string;
  agentName: string;
  days: number;
  paymentId?: string;
  contact?: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
}

const boosts = new Map<string, Boost>();
let sql: ReturnType<typeof postgres> | null = null;
let tableReady = false;

function keyOf(chainId: number, tokenId: string): string {
  return `${chainId}/${tokenId}`;
}

function db(): ReturnType<typeof postgres> | null {
  if (!process.env.DATABASE_URL) return null;
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 5,
    });
  }
  return sql;
}

async function ensureTable(): Promise<boolean> {
  const c = db();
  if (!c) return false;
  if (tableReady) return true;
  try {
    await c`
      create table if not exists boosts (
        id text primary key,
        chain_id integer not null,
        token_id text not null,
        agent_name text not null default '',
        days integer not null,
        payment_id text,
        contact text,
        created_at timestamptz not null,
        expires_at timestamptz not null,
        active boolean not null default true
      )
    `;
    tableReady = true;
    return true;
  } catch {
    return false;
  }
}

function isLive(b: Boost): boolean {
  return b.active && new Date(b.expiresAt).getTime() > Date.now();
}

export function getBoost(chainId: number, tokenId: string): Boost | undefined {
  const b = boosts.get(keyOf(chainId, tokenId));
  if (!b) return undefined;
  return isLive(b) ? b : undefined;
}

export function isBoosted(chainId: number, tokenId: string): boolean {
  return Boolean(getBoost(chainId, tokenId));
}

export function listActiveBoosts(): Boost[] {
  return [...boosts.values()].filter(isLive).sort((a, b) => b.expiresAt.localeCompare(a.expiresAt));
}

export async function recordBoost(input: {
  chainId: number;
  tokenId: string;
  agentName: string;
  days: number;
  paymentId?: string;
  contact?: string;
}): Promise<Boost> {
  const days = Math.max(1, Math.min(90, Math.round(input.days)));
  const now = new Date();
  const expires = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const existing = boosts.get(keyOf(input.chainId, input.tokenId));
  const base = existing && isLive(existing) ? new Date(existing.expiresAt).getTime() : now.getTime();
  const expiresAt = new Date(Math.max(base, now.getTime()) + days * 24 * 60 * 60 * 1000).toISOString();
  const boost: Boost = {
    id: existing?.id ?? `${input.tokenId}-${now.getTime()}`,
    chainId: input.chainId,
    tokenId: input.tokenId,
    agentName: input.agentName,
    days,
    paymentId: input.paymentId,
    contact: input.contact,
    createdAt: now.toISOString(),
    expiresAt,
    active: true,
  };
  boosts.set(keyOf(input.chainId, input.tokenId), boost);
  void (async () => {
    if (!(await ensureTable()) || !sql) return;
    try {
      await sql!`
        insert into boosts (id, chain_id, token_id, agent_name, days, payment_id, contact, created_at, expires_at, active)
        values (
          ${boost.id}, ${boost.chainId}, ${boost.tokenId}, ${boost.agentName}, ${boost.days},
          ${boost.paymentId ?? null}, ${boost.contact ?? null}, ${boost.createdAt}, ${boost.expiresAt}, true
        )
        on conflict (id) do update set
          days = boosts.days + excluded.days,
          expires_at = excluded.expires_at,
          payment_id = excluded.payment_id,
          contact = coalesce(excluded.contact, boosts.contact),
          active = true
      `;
    } catch {
      // memory remains source of truth if postgres is unavailable
    }
  })();
  void expires; // silence unused if tree-shaken differently
  return boost;
}

export async function hydrateBoostsFromDb(limit = 200): Promise<void> {
  if (!(await ensureTable()) || !sql) return;
  try {
    const rows = await sql!`
      select id, chain_id, token_id, agent_name, days, payment_id, contact, created_at, expires_at, active
      from boosts
      where active = true
      order by expires_at desc
      limit ${limit}
    `;
    for (const r of rows) {
      const b: Boost = {
        id: String(r.id),
        chainId: Number(r.chain_id),
        tokenId: String(r.token_id),
        agentName: String(r.agent_name ?? ""),
        days: Number(r.days),
        paymentId: r.payment_id ? String(r.payment_id) : undefined,
        contact: r.contact ? String(r.contact) : undefined,
        createdAt: new Date(r.created_at as string).toISOString(),
        expiresAt: new Date(r.expires_at as string).toISOString(),
        active: Boolean(r.active),
      };
      if (isLive(b)) boosts.set(keyOf(b.chainId, b.tokenId), b);
    }
  } catch {
  }
}
