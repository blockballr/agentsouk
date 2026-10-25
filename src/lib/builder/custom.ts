// Custom agent builder: manifest schema, validation, and store (DB-backed
// when DATABASE_URL is set, in-memory otherwise).

import "server-only";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

export interface CustomAction {
  name: string;
  venue: string;
  contracts: string[];
  functions: string[];
  maxValueUsd: number;
}

export interface CustomManifest {
  name: string;
  category: string;
  description: string;
  runtime: string;
  entrypoint: string;
  endpoint: string;
  wallet: CustomWalletModel;
  payment: CustomPayment;
  deliverable: string;
  release: string;
  actions: CustomAction[];
  env: string[];
  healthcheck: string;
}

const FORBIDDEN = /seed phrase|private key|mnemonic|secret key/i;

function isString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateCustomManifest(input: unknown): { ok: true; manifest: CustomManifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }
  const m = input as Record<string, unknown>;

  if (!isString(m.name)) errors.push("name is required");
  else if (m.name.length > 32) errors.push("name must be at most 32 characters (keeps the deploy slug short)");
  else if (FORBIDDEN.test(m.name)) errors.push("name contains forbidden terms");
  if (!isString(m.category)) errors.push("category is required");
  if (!isString(m.description)) errors.push("description is required");
  else if (FORBIDDEN.test(m.description)) errors.push("description contains forbidden terms");
  if (!isString(m.runtime)) errors.push("runtime is required");
  if (!isString(m.entrypoint)) errors.push("entrypoint is required");
  if (!isString(m.endpoint)) errors.push("endpoint is required");
  if (!isString(m.wallet)) errors.push("wallet is required");
  else if (!["agent", "vault", "session", "none"].includes(m.wallet as string)) errors.push("wallet must be agent, vault, session, or none");
  if (!isString(m.payment)) errors.push("payment is required");
  else if (!["x402", "job", "vault"].includes(m.payment as string)) errors.push("payment must be x402, job, or vault");
  // a vault hire is custody for the buyer and no key for the agent, so the two
  // fields have to agree
  if (m.payment === "vault" && m.wallet !== "vault") errors.push("payment vault requires wallet vault");
  if (m.payment !== "vault" && m.wallet === "vault") errors.push("wallet vault requires payment vault");
  if (!isString(m.deliverable)) errors.push("deliverable is required");
  if (!isString(m.release)) errors.push("release is required");
  if (!isString(m.healthcheck)) errors.push("healthcheck is required");
  if (!isStringArray(m.env)) errors.push("env must be an array of strings");

  if (!Array.isArray(m.actions)) errors.push("actions must be an array");
  else {
    (m.actions as unknown[]).forEach((a, i) => {
      if (!a || typeof a !== "object" || Array.isArray(a)) { errors.push(`actions[${i}] must be an object`); return; }
      const act = a as Record<string, unknown>;
      if (!isString(act.name)) errors.push(`actions[${i}].name is required`);
      if (!isString(act.venue)) errors.push(`actions[${i}].venue is required`);
      if (!isStringArray(act.contracts)) errors.push(`actions[${i}].contracts must be an array of strings`);
      if (!isStringArray(act.functions)) errors.push(`actions[${i}].functions must be an array of strings`);
      if (typeof act.maxValueUsd !== "number" || !Number.isFinite(act.maxValueUsd) || act.maxValueUsd < 0) {
        errors.push(`actions[${i}].maxValueUsd must be a non-negative number`);
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const manifest: CustomManifest = {
    name: (m.name as string).trim(),
    category: (m.category as string).trim(),
    description: (m.description as string).trim(),
    runtime: (m.runtime as string).trim(),
    entrypoint: (m.entrypoint as string).trim(),
    endpoint: (m.endpoint as string).trim(),
    wallet: m.wallet as CustomWalletModel,
    payment: m.payment as CustomPayment,
    deliverable: (m.deliverable as string).trim(),
    release: (m.release as string).trim(),
    actions: (m.actions as unknown[]).map((a) => {
      const act = a as Record<string, unknown>;
      return {
        name: (act.name as string).trim(),
        venue: (act.venue as string).trim(),
        contracts: (act.contracts as string[]).map((x) => x.trim()),
        functions: (act.functions as string[]).map((x) => x.trim()),
        maxValueUsd: act.maxValueUsd as number,
      };
    }),
    env: (m.env as string[]).map((x) => x.trim()),
    healthcheck: (m.healthcheck as string).trim(),
  };
  return { ok: true, manifest };
}

export const validateManifest = validateCustomManifest;

export type CustomWalletModel = "agent" | "vault" | "session" | "none";
export type CustomPayment = "x402" | "job" | "vault";
export type CustomBadge = "new" | "established" | "unknown";

export interface CustomAction {
  name: string;
  venue: string;
  contracts: string[];
  functions: string[];
  maxValueUsd: number;
}

export interface CustomManifest {
  name: string;
  category: string;
  description: string;
  runtime: string;
  entrypoint: string;
  endpoint: string;
  wallet: CustomWalletModel;
  payment: CustomPayment;
  deliverable: string;
  release: string;
  actions: CustomAction[];
  env: string[];
  healthcheck: string;
}

export interface CustomAgent {
  id: string;
  owner: string;
  manifest: CustomManifest;
  buildId: string | null;
  image: string | null;
  walletAddress: string | null;
  onChainTokenId: string | null;
  deployment: { ok: boolean; projectId?: string | null; url?: string | null; error?: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

const ID = /^[0-9a-f]{16}$/;

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 });
}

const memory = new Map<string, CustomAgent>();
let tableReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists custom_agents (
          id text primary key,
          owner text not null,
          manifest jsonb not null,
          build_id text,
          image text,
          wallet_address text,
          on_chain_token_id text,
          deployment jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql!`create index if not exists custom_agents_owner on custom_agents (owner, created_at desc)`;
      return true;
    } catch {
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

async function store(): Promise<ReturnType<typeof postgres> | null> {
  if (!sql) return null;
  if (!(await ensureTable())) throw new Error("custom agents store unavailable");
  return sql;
}

type Row = { id: string; owner: string; manifest: unknown; build_id: string | null; image: string | null; wallet_address: string | null; on_chain_token_id: string | null; deployment: unknown; created_at: Date | string; updated_at: Date | string };

function fromRow(row: Row): CustomAgent | undefined {
  const check = validateCustomManifest(row.manifest);
  if (!check.ok) return undefined;
  return {
    id: row.id,
    owner: row.owner,
    manifest: check.manifest,
    buildId: row.build_id,
    image: row.image,
    walletAddress: row.wallet_address,
    onChainTokenId: row.on_chain_token_id,
    deployment: (row.deployment as CustomAgent["deployment"]) ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function isCustomId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export async function saveCustomAgent(owner: string, manifest: CustomManifest, buildId: string | null = null): Promise<CustomAgent> {
  const id = randomBytes(8).toString("hex");
  const now = new Date().toISOString();
  const agent: CustomAgent = {
    id,
    owner: owner.toLowerCase(),
    manifest,
    buildId,
    image: null,
    walletAddress: null,
    onChainTokenId: null,
    deployment: null,
    createdAt: now,
    updatedAt: now,
  };

  const db = await store();
  if (db) {
    await db`
      insert into custom_agents (id, owner, manifest, build_id, image, wallet_address, on_chain_token_id, deployment, created_at, updated_at)
      values (${agent.id}, ${agent.owner}, ${db.json(manifest as never)}, ${agent.buildId}, ${agent.image}, ${agent.walletAddress}, ${agent.onChainTokenId}, ${agent.deployment ? db.json(agent.deployment as never) : null}, ${agent.createdAt}, ${agent.updatedAt})
    `;
    return agent;
  }
  memory.set(id, agent);
  return agent;
}

export async function getCustomAgent(id: string): Promise<CustomAgent | undefined> {
  if (!isCustomId(id)) return undefined;
  const db = await store();
  if (db) {
    const rows = (await db`select * from custom_agents where id = ${id} limit 1`) as Row[];
    if (!rows[0]) return undefined;
    return fromRow(rows[0]);
  }
  return memory.get(id);
}

export async function getCustomAgentByTokenId(tokenId: string): Promise<CustomAgent | undefined> {
  const db = await store();
  if (db) {
    const rows = (await db`select * from custom_agents where on_chain_token_id = ${tokenId} limit 1`) as Row[];
    if (!rows[0]) return undefined;
    return fromRow(rows[0]);
  }
  return [...memory.values()].find((a) => a.onChainTokenId === tokenId);
}

export async function listCustomByOwner(owner: string): Promise<CustomAgent[]> {
  const o = owner.toLowerCase();
  const db = await store();
  if (db) {
    const rows = (await db`select * from custom_agents where owner = ${o} order by created_at desc`) as Row[];
    return rows.flatMap((r) => fromRow(r) ?? []);
  }
  return [...memory.values()].filter((a) => a.owner === o).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}


export async function listCustomAgents(): Promise<CustomAgent[]> {
  const out = new Map<string, CustomAgent>();
  for (const a of memory.values()) out.set(a.id, a);
  const s = await store().catch(() => null);
  if (s) {
    try {
      const rows = (await s`select * from custom_agents order by created_at desc`) as Row[];
      for (const row of rows) {
        const a = fromRow(row);
        if (a) out.set(a.id, a);
      }
    } catch {
      // memory only
    }
  }
  return [...out.values()];
}

export async function updateCustomAgent(id: string, patch: Partial<CustomAgent>): Promise<CustomAgent | undefined> {
  const existing = await getCustomAgent(id);
  if (!existing) return undefined;
  const updated: CustomAgent = { ...existing, ...patch, updatedAt: new Date().toISOString() };

  const db = await store();
  if (db) {
    await db`
      update custom_agents set
        manifest = ${db.json(updated.manifest as never)},
        build_id = ${updated.buildId},
        image = ${updated.image},
        wallet_address = ${updated.walletAddress},
        on_chain_token_id = ${updated.onChainTokenId},
        deployment = ${updated.deployment ? db.json(updated.deployment as never) : null},
        updated_at = ${updated.updatedAt}
      where id = ${id}
    `;
    return updated;
  }
  memory.set(id, updated);
  return updated;
}

export function resetCustomAgentsForTests(): void {
  memory.clear();
}

export function buildId(): string {
  return randomBytes(8).toString("hex");
}