// shared notifications outbox: every subscription/billing/deploy event lands here
// as a row, and a worker drains it. Nothing auto-sends; the row is the record
// and the drain is explicit, so a missed delivery is visible instead of silent.

import "server-only";
import postgres from "postgres";

export type OutboxKind =
  | "deploy_live"
  | "deploy_failed"
  | "build_minutes_low"
  | "trial_expiring"
  | "tollgate"
  | "plan_changed"
  | "topup_needed"
  | "export_ready";

export interface OutboxRow {
  id: string;
  kind: OutboxKind;
  owner: string;
  payload: Record<string, unknown>;
  status: "pending" | "sent" | "failed";
  createdAt: string;
  sentAt: string | null;
  error: string | null;
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
        create table if not exists notification_outbox (
          id bigserial primary key,
          kind text not null,
          owner text not null,
          payload jsonb not null default '{}'::jsonb,
          status text not null default 'pending',
          error text,
          created_at timestamptz not null default now(),
          sent_at timestamptz
        )
      `;
      await sql!`create index if not exists notification_outbox_status_idx on notification_outbox (status, created_at)`;
      await sql!`create index if not exists notification_outbox_owner_idx on notification_outbox (owner, created_at desc)`;
      return true;
    } catch {
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

const memory: OutboxRow[] = [];

// enqueue an event. Returns the row id (or null when no store and no memory
// fallback is desired). Never throws: an enqueue failure is logged, not fatal.
export async function enqueue(kind: OutboxKind, owner: string, payload: Record<string, unknown> = {}): Promise<string | null> {
  const o = owner.toLowerCase();
  if (sql && (await ensureTable())) {
    try {
      const rows = (await sql`
        insert into notification_outbox (kind, owner, payload)
        values (${kind}, ${o}, ${sql.json(payload as never)})
        returning id
      `) as { id: string }[];
      return rows[0]?.id ?? null;
    } catch (e) {
      console.error("[outbox] enqueue failed", kind, e instanceof Error ? e.message : String(e));
      return null;
    }
  }
  const row: OutboxRow = { id: String(memory.length + 1), kind, owner: o, payload, status: "pending", createdAt: new Date().toISOString(), sentAt: null, error: null };
  memory.push(row);
  return row.id;
}

export async function listPending(limit = 50): Promise<OutboxRow[]> {
  if (sql && (await ensureTable())) {
    const rows = (await sql`
      select id, kind, owner, payload, status, error, created_at, sent_at
      from notification_outbox where status = 'pending'
      order by created_at asc limit ${limit}
    `) as { id: string; kind: string; owner: string; payload: Record<string, unknown>; status: string; error: string | null; created_at: Date | string; sent_at: Date | string | null }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as OutboxKind,
      owner: r.owner,
      payload: r.payload ?? {},
      status: r.status as OutboxRow["status"],
      createdAt: new Date(r.created_at).toISOString(),
      sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
      error: r.error,
    }));
  }
  return memory.filter((r) => r.status === "pending").slice(0, limit);
}

export async function markSent(id: string): Promise<void> {
  if (sql && (await ensureTable())) {
    await sql`update notification_outbox set status = 'sent', sent_at = now() where id = ${id}`;
    return;
  }
  const row = memory.find((r) => r.id === id);
  if (row) { row.status = "sent"; row.sentAt = new Date().toISOString(); }
}

export async function markFailed(id: string, error: string): Promise<void> {
  if (sql && (await ensureTable())) {
    await sql`update notification_outbox set status = 'failed', error = ${error} where id = ${id}`;
    return;
  }
  const row = memory.find((r) => r.id === id);
  if (row) { row.status = "failed"; row.error = error; }
}
