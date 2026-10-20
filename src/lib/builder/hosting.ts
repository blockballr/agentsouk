// where a built agent lives on our API: its card, and the endpoint the card names

export function builtAgentAddresses(origin: string, id: string): { card: string; endpoint: string } {
  const base = `${origin.replace(/\/+$/, "")}/api/built/${id}`;
  return { card: `${base}/.well-known/agent-card.json`, endpoint: `${base}/a2a` };
}

// ---------------------------------------------------------------------------
// builder_hosting: one CreateOS principal per marketplace wallet.
//
// Build order item 1: the table + the provisioning drive (Free tier only, no
// billing code). The drive creates a CreateOS principal for a buyer's wallet
// out of band and links it here. CreateOS has no public signup API yet, so the
// actual principal creation is a manual step recorded by an operator; the row
// is the source of truth for "does this wallet have hosting".
// ---------------------------------------------------------------------------

import "server-only";
import postgres from "postgres";

export interface BuilderHosting {
  owner: string;            // wallet, lowercased
  createosEmail: string | null;
  createosApiKey: string | null;
  tier: "free" | "plus" | "pro" | "enterprise" | null;
  trialExpiresAt: string | null;
  buildMinutes: number | null;
  credits: number;
  agents: string[];         // built agent ids linked to this principal
  createdAt: string;
  updatedAt: string;
}

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 });
}

let tableReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists builder_hosting (
          owner text primary key,
          createos_email text,
          createos_api_key text,
          tier text,
          trial_expires_at timestamptz,
          build_minutes integer,
          credits numeric not null default 0,
          agents text[] not null default '{}',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
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

type Row = { owner: string; createos_email: string | null; createos_api_key: string | null; tier: string | null; trial_expires_at: Date | string | null; build_minutes: number | null; credits: number | string | null; agents: string[] | null; created_at: Date | string; updated_at: Date | string };

function fromRow(row: Row): BuilderHosting {
  return {
    owner: row.owner,
    createosEmail: row.createos_email,
    createosApiKey: row.createos_api_key,
    tier: (row.tier as BuilderHosting["tier"]) ?? null,
    trialExpiresAt: row.trial_expires_at ? new Date(row.trial_expires_at).toISOString() : null,
    buildMinutes: row.build_minutes,
    credits: Number(row.credits ?? 0),
    agents: row.agents ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function getHosting(owner: string): Promise<BuilderHosting | null> {
  if (!sql) return null;
  if (!(await ensureTable())) return null;
  const rows = (await sql`select * from builder_hosting where owner = ${owner.toLowerCase()} limit 1`) as Row[];
  return rows[0] ? fromRow(rows[0]) : null;
}

// Provisioning drive: Free tier only, no billing code. Records a principal for
// the wallet. Until CreateOS exposes a programmatic signup, the principal is
// created out of band by an operator and the resulting email is recorded here;
// the row's existence is what gates "has hosting".
export async function provisionHosting(owner: string, createosEmail: string | null, createosApiKey: string | null = null): Promise<BuilderHosting> {
  const o = owner.toLowerCase();
  if (!(await ensureTable()) || !sql) {
    // no database: keep an in-memory answer is not possible across instances,
    // so this path requires DATABASE_URL to be set
    throw new Error("hosting store unavailable");
  }
  await sql`
    insert into builder_hosting (owner, createos_email, createos_api_key, tier, created_at, updated_at)
    values (${o}, ${createosEmail}, ${createosApiKey}, 'free', now(), now())
    on conflict (owner) do update set
      createos_email = coalesce(excluded.createos_email, builder_hosting.createos_email),
      createos_api_key = coalesce(excluded.createos_api_key, builder_hosting.createos_api_key),
      updated_at = now()
  `;
  const row = (await sql`select * from builder_hosting where owner = ${o} limit 1`) as Row[];
  if (!row[0]) throw new Error("hosting row not persisted");
  return fromRow(row[0]);
}

export async function linkAgent(owner: string, agentId: string): Promise<void> {
  if (!sql || !(await ensureTable())) return;
  await sql`
    update builder_hosting set agents = array_append(agents, ${agentId}), updated_at = now()
    where owner = ${owner.toLowerCase()} and not (${agentId} = any(agents))
  `;
}

export async function setApiKey(owner: string, apiKey: string): Promise<BuilderHosting | null> {
  if (!sql || !(await ensureTable())) return null;
  const o = owner.toLowerCase();
  await sql`
    update builder_hosting set createos_api_key = ${apiKey}, updated_at = now()
    where owner = ${o}
  `;
  return getHosting(o);
}

export async function topUpCredits(owner: string, amountUsd: number): Promise<BuilderHosting | null> {
  if (!sql || !(await ensureTable())) return null;
  const o = owner.toLowerCase();
  const existing = await getHosting(o);
  if (!existing) return null;
  await sql`update builder_hosting set credits = credits + ${amountUsd}, updated_at = now() where owner = ${o}`;
  return getHosting(o);
}

export async function changePlan(owner: string, tier: BuilderHosting["tier"], costUsd: number): Promise<{ ok: boolean; reason?: string; hosting: BuilderHosting | null }> {
  const h = await getHosting(owner);
  if (!h) return { ok: false, reason: "no hosting row", hosting: null };
  if (h.credits < costUsd) return { ok: false, reason: "insufficient credits", hosting: h };
  if (!sql || !(await ensureTable())) return { ok: false, reason: "store unavailable", hosting: h };
  const o = owner.toLowerCase();
  await sql`update builder_hosting set tier = ${tier}, credits = credits - ${costUsd}, updated_at = now() where owner = ${o}`;
  return { ok: true, hosting: await getHosting(o) };
}
