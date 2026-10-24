import "server-only";

import postgres from "postgres";
import { vaultFor } from "./vault";

// A small registry mapping a hire (chainId + hireId) to the policy that owns it.
// Without it, every sweep would try to trade every open hire, and a Porter hire
// would get a Band trade on top of its defense. The registry is the operator's
// way of saying "this hire belongs to the health-factor agent", so the sweeps
// can skip hires that are not theirs.
//
// Storage: Postgres when DATABASE_URL is set, in-memory otherwise. Same shape
// as the strategy store and receipt store.

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 });
}

const MEMORY_CAP = 5000;
const policies = new Map<string, string>();
let tablesReady: Promise<boolean> | null = null;

function vaultKey(chainId: number): string {
  return vaultFor(chainId) ?? "";
}

function key(chainId: number, hireId: string): string {
  return `${chainId}:${vaultKey(chainId)}:${hireId}`;
}

async function ensureTables(): Promise<boolean> {
  if (!sql) return false;
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    try {
      await sql!`
        create table if not exists hire_policy (
          chain_id integer not null,
          vault text not null default '',
          hire_id text not null,
          policy text not null,
          updated_at timestamptz not null default now(),
          primary key (chain_id, vault, hire_id)
        )`;
      await sql!`alter table hire_policy add column if not exists vault text not null default ''`;
      await sql!`alter table hire_policy drop constraint if exists hire_policy_pkey`;
      await sql!`alter table hire_policy add primary key (chain_id, vault, hire_id)`;
      return true;
    } catch {
      return false;
    }
  })();
  return tablesReady;
}

export async function getHirePolicy(chainId: number, hireId: string): Promise<string | null> {
  const k = key(chainId, hireId);
  const vault = vaultKey(chainId);
  if (sql && (await ensureTables())) {
    try {
      const rows = await sql`select policy from hire_policy where chain_id = ${chainId} and vault = ${vault} and hire_id = ${hireId}`;
      const row = rows[0] as { policy: string } | undefined;
      return row?.policy ?? null;
    } catch {
      // fall through to memory only when the database did not answer
    }
  }
  return policies.get(k) ?? null;
}

export async function setHirePolicy(chainId: number, hireId: string, policy: string): Promise<void> {
  const k = key(chainId, hireId);
  const vault = vaultKey(chainId);
  if (policies.size >= MEMORY_CAP && !policies.has(k)) {
    const oldest = policies.keys().next().value;
    if (oldest !== undefined) policies.delete(oldest);
  }
  policies.set(k, policy);
  if (sql && (await ensureTables())) {
    try {
      await sql`
        insert into hire_policy (chain_id, vault, hire_id, policy)
        values (${chainId}, ${vault}, ${hireId}, ${policy})
        on conflict (chain_id, vault, hire_id) do update set
          policy = excluded.policy,
          updated_at = now()`;
    } catch {
      // memory row still stands
    }
  }
}

export async function listHirePolicies(chainId: number): Promise<Array<{ hireId: string; policy: string }>> {
  const out: Array<{ hireId: string; policy: string }> = [];
  const vault = vaultKey(chainId);
  if (sql && (await ensureTables())) {
    try {
      const rows = await sql`select hire_id, policy from hire_policy where chain_id = ${chainId} and vault = ${vault}`;
      for (const r of rows as unknown as Array<{ hire_id: string; policy: string }>) {
        out.push({ hireId: r.hire_id, policy: r.policy });
      }
      return out;
    } catch {
      // fall through
    }
  }
  for (const [k, v] of policies) {
    const [c, va, id] = k.split(":");
    if (Number(c) === chainId && va === vault) out.push({ hireId: id, policy: v });
  }
  return out;
}
