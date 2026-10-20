// server-only: the agents visitors have built, each a blueprint kept under an id we host it at
// memory stands in only where there is no database at all

import "server-only";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { validateBlueprint, type Blueprint } from "./blueprint";
import { generateSellerKey } from "./keys";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

export interface BuiltAgent {
  id: string;
  owner: string;
  blueprint: Blueprint;
  sellerKeyAddress: string | null;
  createdAt: string;
}

// a wallet may try a few descriptions before it settles on one; older tries are dropped
export const DRAFTS_PER_OWNER = 5;

const ID = /^[0-9a-f]{16}$/;
const memory = new Map<string, BuiltAgent>();
let tableReady: Promise<boolean> | null = null;

export function isBuiltId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists built_agents (
          id text primary key,
          owner text not null,
          blueprint jsonb not null,
          created_at timestamptz not null default now()
        )
      `;
      await sql!`create index if not exists built_agents_owner on built_agents (owner, created_at desc)`;
      return true;
    } catch {
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

// a configured database that cannot be used is an error, never a quiet move to memory
async function store(): Promise<ReturnType<typeof postgres> | null> {
  if (!sql) return null;
  if (!(await ensureTable())) throw new Error("built agents store unavailable");
  return sql;
}

type Row = { id: string; owner: string; blueprint: unknown; created_at: Date | string };

// a stored blueprint is checked again on the way out, so a rule added later still holds for it
function fromRow(row: Row): BuiltAgent | undefined {
  const check = validateBlueprint(row.blueprint);
  if (!check.ok) return undefined;
  return { id: row.id, owner: row.owner, blueprint: check.blueprint, sellerKeyAddress: null, createdAt: new Date(row.created_at).toISOString() };
}

export async function saveBuiltAgent(owner: string, blueprint: Blueprint): Promise<BuiltAgent> {
  const needsKey = blueprint.hireMode === "job" || blueprint.hireMode === "both";
  const id = randomBytes(8).toString("hex");
  const sellerKeyAddress = needsKey ? await generateSellerKey(owner, id) : null;
  const built: BuiltAgent = { id, owner: owner.toLowerCase(), blueprint, sellerKeyAddress, createdAt: new Date().toISOString() };
  const db = await store();
  if (db) {
    await db`
      insert into built_agents (id, owner, blueprint, created_at)
      values (${built.id}, ${built.owner}, ${db.json(blueprint as never)}, ${built.createdAt})
    `;
    await db`
      delete from built_agents where owner = ${built.owner} and id not in (
        select id from built_agents where owner = ${built.owner} order by created_at desc limit ${DRAFTS_PER_OWNER}
      )
    `;
    return built;
  }
  memory.set(built.id, built);
  const mine = [...memory.values()].filter((b) => b.owner === built.owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const old of mine.slice(DRAFTS_PER_OWNER)) memory.delete(old.id);
  return built;
}

export async function getBuiltAgent(id: string): Promise<BuiltAgent | undefined> {
  if (!isBuiltId(id)) return undefined;
  const db = await store();
  if (db) {
    const rows = (await db`select id, owner, blueprint, created_at from built_agents where id = ${id} limit 1`) as Row[];
    if (!rows[0]) return undefined;
    const built = fromRow(rows[0]);
    if (!built) return undefined;
    // resolve the seller key address (per-owner key) if one was generated
    const keyRows = (await db`select address from builder_seller_keys where agent_id = ${id} limit 1`) as { address: string }[];
    if (keyRows[0]) built.sellerKeyAddress = keyRows[0].address;
    return built;
  }
  return memory.get(id);
}

export async function listBuiltByOwner(owner: string): Promise<BuiltAgent[]> {
  const o = owner.toLowerCase();
  const db = await store();
  if (db) {
    const rows = (await db`
      select id, owner, blueprint, created_at from built_agents where owner = ${o} order by created_at desc limit ${DRAFTS_PER_OWNER}
    `) as Row[];
    return rows.flatMap((r) => fromRow(r) ?? []);
  }
  return [...memory.values()].filter((b) => b.owner === o).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resetBuiltAgentsForTests(): void {
  memory.clear();
}
