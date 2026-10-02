// server-only records behind the team panel: members, sign-in nonces, sessions and the log
// memory stands in only where there is no database at all

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import {
  NONCE_TTL_MS,
  SESSION_TTL_MS,
  isAddress,
  isStationRole,
  memberChangeProblem,
  type StationMember,
  type StationRole,
} from "./station";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

// thrown when a database is configured and cannot be used; a route answers 503 with it
export class StationUnavailable extends Error {
  constructor() {
    super("the station's records cannot be read just now");
  }
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  detail: string | null;
}

const mem = {
  members: new Map<string, StationMember>(),
  nonces: new Map<string, { address: string; expiresAt: number }>(),
  sessions: new Map<string, { address: string; expiresAt: number }>(),
  audit: [] as AuditEntry[],
};
let tablesReady: Promise<boolean> | null = null;
let seeded = false;

async function ensureTables(): Promise<boolean> {
  if (!sql) return false;
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    try {
      await sql!`
        create table if not exists station_members (
          address text primary key,
          role text not null,
          added_by text,
          added_at timestamptz not null default now()
        )
      `;
      await sql!`
        create table if not exists station_nonces (
          nonce text primary key,
          address text not null,
          expires_at timestamptz not null
        )
      `;
      await sql!`
        create table if not exists station_sessions (
          token_hash text primary key,
          address text not null,
          expires_at timestamptz not null,
          created_at timestamptz not null default now()
        )
      `;
      await sql!`
        create table if not exists station_audit (
          id bigserial primary key,
          at timestamptz not null default now(),
          actor text not null,
          action text not null,
          detail text
        )
      `;
      return true;
    } catch {
      tablesReady = null;
      return false;
    }
  })();
  return tablesReady;
}

// the database when there is one, nothing when there is none
// a configured database that fails is an error, never a quiet move to memory
async function store(): Promise<ReturnType<typeof postgres> | null> {
  if (!sql) return null;
  if (!(await ensureTables())) throw new StationUnavailable();
  return sql;
}

// only the hash of a session token is kept, so a read of the table opens no session
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// the deployment's own owner is put in whenever the station has no owner at all
async function seedFirstOwner(): Promise<void> {
  if (seeded) return;
  const owner = (process.env.STATION_OWNER ?? "").trim();
  if (!isAddress(owner)) return;
  const address = owner.toLowerCase();
  const db = await store();
  if (db) {
    const owners = await db`select 1 from station_members where role = 'owner' limit 1`;
    if (owners.length === 0) {
      await db`
        insert into station_members (address, role, added_by) values (${address}, 'owner', null)
        on conflict (address) do update set role = 'owner'
      `;
    }
    seeded = true;
    return;
  }
  if (![...mem.members.values()].some((m) => m.role === "owner")) {
    const held = mem.members.get(address);
    mem.members.set(address, { address, role: "owner", addedBy: held?.addedBy ?? null, addedAt: held?.addedAt ?? new Date().toISOString() });
  }
  seeded = true;
}

type MemberRow = { address: string; role: string; added_by: string | null; added_at: Date | string };

function fromRows(rows: readonly MemberRow[]): StationMember[] {
  return rows.flatMap((r) =>
    isStationRole(r.role)
      ? [{ address: r.address, role: r.role, addedBy: r.added_by, addedAt: new Date(r.added_at).toISOString() }]
      : [],
  );
}

export async function listMembers(): Promise<StationMember[]> {
  await seedFirstOwner();
  const db = await store();
  if (db) {
    return fromRows((await db`select address, role, added_by, added_at from station_members order by added_at asc`) as MemberRow[]);
  }
  return [...mem.members.values()];
}

export async function getMember(address: string): Promise<StationMember | undefined> {
  const a = address.toLowerCase();
  return (await listMembers()).find((m) => m.address === a);
}

// the actor's role is read again under the lock, in case it changed since the request was let in
function stillOwner(members: readonly StationMember[], actor: string): string | null {
  return members.some((m) => m.address === actor && m.role === "owner") ? null : "only an owner can change members";
}

// adds, changes or removes one member and writes its log line, as a single step
// the last-owner rule is checked under a lock, so two owners acting at once cannot both pass it
export async function changeMember(target: string, next: StationRole | null, by: string): Promise<string | null> {
  await seedFirstOwner();
  const a = target.toLowerCase();
  const actor = by.toLowerCase();
  const action = next ? `made ${a} ${next}` : `removed ${a}`;
  const db = await store();
  if (db) {
    return (await db.begin(async (tx) => {
      await tx`lock table station_members in share row exclusive mode`;
      const members = fromRows((await tx`select address, role, added_by, added_at from station_members`) as MemberRow[]);
      const problem = stillOwner(members, actor) ?? memberChangeProblem(members, a, next);
      if (problem) return problem;
      if (next) {
        await tx`
          insert into station_members (address, role, added_by) values (${a}, ${next}, ${actor})
          on conflict (address) do update set role = excluded.role
        `;
      } else {
        await tx`delete from station_members where address = ${a}`;
        // a removed member's sessions end with their membership
        await tx`delete from station_sessions where address = ${a}`;
      }
      await tx`insert into station_audit (actor, action, detail) values (${actor}, ${action}, null)`;
      return null;
    })) as string | null;
  }
  // nothing is awaited between the check and the write, so memory needs no lock
  const members = [...mem.members.values()];
  const problem = stillOwner(members, actor) ?? memberChangeProblem(members, a, next);
  if (problem) return problem;
  if (next) {
    const held = mem.members.get(a);
    mem.members.set(a, { address: a, role: next, addedBy: held?.addedBy ?? actor, addedAt: held?.addedAt ?? new Date().toISOString() });
  } else {
    mem.members.delete(a);
    for (const [hash, s] of mem.sessions) if (s.address === a) mem.sessions.delete(hash);
  }
  remember({ at: new Date().toISOString(), actor, action, detail: null });
  return null;
}

export async function issueNonce(address: string, now = Date.now()): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const a = address.toLowerCase();
  const db = await store();
  if (db) {
    await db`delete from station_nonces where expires_at < ${new Date(now).toISOString()}`;
    await db`
      insert into station_nonces (nonce, address, expires_at)
      values (${nonce}, ${a}, ${new Date(now + NONCE_TTL_MS).toISOString()})
    `;
    return nonce;
  }
  for (const [n, v] of mem.nonces) if (v.expiresAt < now) mem.nonces.delete(n);
  mem.nonces.set(nonce, { address: a, expiresAt: now + NONCE_TTL_MS });
  return nonce;
}

// true once, for the address the nonce was issued to, inside its five minutes
export async function spendNonce(nonce: string, address: string, now = Date.now()): Promise<boolean> {
  const a = address.toLowerCase();
  const db = await store();
  if (db) {
    const rows = await db`
      delete from station_nonces
      where nonce = ${nonce} and address = ${a} and expires_at >= ${new Date(now).toISOString()}
      returning nonce
    `;
    return rows.length === 1;
  }
  const found = mem.nonces.get(nonce);
  if (!found || found.address !== a) return false;
  mem.nonces.delete(nonce);
  return found.expiresAt >= now;
}

export async function openSession(address: string, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("hex");
  const a = address.toLowerCase();
  const expires = now + SESSION_TTL_MS;
  const db = await store();
  if (db) {
    await db`delete from station_sessions where expires_at < ${new Date(now).toISOString()}`;
    await db`
      insert into station_sessions (token_hash, address, expires_at)
      values (${hashToken(token)}, ${a}, ${new Date(expires).toISOString()})
    `;
  } else {
    for (const [hash, s] of mem.sessions) if (s.expiresAt < now) mem.sessions.delete(hash);
    mem.sessions.set(hashToken(token), { address: a, expiresAt: expires });
  }
  return { token, expiresAt: new Date(expires).toISOString() };
}

// the address a live session belongs to, or nothing; membership is checked again by the caller
export async function sessionAddress(token: string, now = Date.now()): Promise<string | undefined> {
  if (!/^[0-9a-f]{64}$/.test(token)) return undefined;
  const hash = hashToken(token);
  const db = await store();
  if (db) {
    const rows = (await db`
      select address from station_sessions
      where token_hash = ${hash} and expires_at >= ${new Date(now).toISOString()} limit 1
    `) as { address: string }[];
    return rows[0]?.address;
  }
  const found = mem.sessions.get(hash);
  return found && found.expiresAt >= now ? found.address : undefined;
}

// signing out ends this session, or every session the wallet has open
export async function closeSessions(token: string, address: string, all: boolean): Promise<void> {
  const a = address.toLowerCase();
  const hash = hashToken(token);
  const db = await store();
  if (db) {
    if (all) await db`delete from station_sessions where address = ${a}`;
    else await db`delete from station_sessions where token_hash = ${hash}`;
    return;
  }
  if (!all) {
    mem.sessions.delete(hash);
    return;
  }
  for (const [h, s] of mem.sessions) if (s.address === a) mem.sessions.delete(h);
}

function remember(entry: AuditEntry): void {
  mem.audit.push(entry);
  if (mem.audit.length > 1000) mem.audit.splice(0, mem.audit.length - 1000);
}

// a log line that cannot be written is reported, and never stops the thing it describes
export async function recordAudit(actor: string, action: string, detail: string | null = null): Promise<void> {
  const entry: AuditEntry = { at: new Date().toISOString(), actor: actor.toLowerCase(), action, detail };
  try {
    const db = await store();
    if (db) await db`insert into station_audit (actor, action, detail) values (${entry.actor}, ${action}, ${detail})`;
    else remember(entry);
  } catch (e) {
    console.error("[station] audit line not written", action, (e as Error).message);
  }
}

export async function listAudit(limit = 200): Promise<AuditEntry[]> {
  const db = await store();
  if (db) {
    const rows = (await db`
      select at, actor, action, detail from station_audit order by id desc limit ${limit}
    `) as { at: Date | string; actor: string; action: string; detail: string | null }[];
    return rows.map((r) => ({ at: new Date(r.at).toISOString(), actor: r.actor, action: r.action, detail: r.detail }));
  }
  return [...mem.audit].reverse().slice(0, limit);
}

export function resetStationForTests(): void {
  mem.members.clear();
  mem.nonces.clear();
  mem.sessions.clear();
  mem.audit.length = 0;
  seeded = false;
}
