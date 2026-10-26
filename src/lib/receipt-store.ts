import "server-only";
import postgres from "postgres";

export interface Receipt {
  id: string;
  chainId: number;
  hireId: string;
  agent: string;
  status: "traded" | "skipped" | "refused";
  reason: string | null;
  txHash: string | null;
  blockNumber: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  trigger: Record<string, unknown> | null;
  guardrail: Record<string, unknown> | null;
  simulation: Record<string, unknown> | null;
  policy: string;
  createdAt: string;
}

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 });
}

const MEMORY_CAP = 5000;
const receipts = new Map<string, Receipt>();
let tablesReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    try {
      await sql!`
        create table if not exists execution_receipt (
          id text primary key,
          chain_id integer not null,
          hire_id text not null,
          agent text not null,
          status text not null,
          reason text,
          tx_hash text,
          block_number bigint,
          before_state jsonb,
          after_state jsonb,
          trigger_facts jsonb,
          guardrail jsonb,
          simulation jsonb,
          policy text not null,
          created_at timestamptz not null default now()
        )`;
      await sql!`alter table execution_receipt add column if not exists trigger_facts jsonb`;
      await sql!`alter table execution_receipt add column if not exists guardrail jsonb`;
      await sql!`alter table execution_receipt add column if not exists simulation jsonb`;
      await sql!`create index if not exists execution_receipt_hire_idx on execution_receipt (chain_id, hire_id)`;
      await sql!`create index if not exists execution_receipt_agent_idx on execution_receipt (agent, created_at desc)`;
      return true;
    } catch {
      return false;
    }
  })();
  return tablesReady;
}

export async function writeReceipt(r: Omit<Receipt, "id" | "createdAt"> & { id?: string }): Promise<Receipt> {
  const receipt: Receipt = {
    id: r.id ?? crypto.randomUUID(),
    chainId: r.chainId,
    hireId: r.hireId,
    agent: r.agent.toLowerCase(),
    status: r.status,
    reason: r.reason,
    txHash: r.txHash,
    blockNumber: r.blockNumber,
    before: r.before,
    after: r.after,
    trigger: r.trigger ?? null,
    guardrail: r.guardrail ?? null,
    simulation: r.simulation ?? null,
    policy: r.policy,
    createdAt: new Date().toISOString(),
  };
  const db = await ensureTable().then((ok) => (ok ? sql : null));
  if (db) {
    try {
      await db`
        insert into execution_receipt (id, chain_id, hire_id, agent, status, reason, tx_hash, block_number, before_state, after_state, trigger_facts, guardrail, simulation, policy, created_at)
        values (${receipt.id}, ${receipt.chainId}, ${receipt.hireId}, ${receipt.agent}, ${receipt.status}, ${receipt.reason}, ${receipt.txHash}, ${receipt.blockNumber}, ${receipt.before ? db.json(receipt.before as never) : null}, ${receipt.after ? db.json(receipt.after as never) : null}, ${receipt.trigger ? db.json(receipt.trigger as never) : null}, ${receipt.guardrail ? db.json(receipt.guardrail as never) : null}, ${receipt.simulation ? db.json(receipt.simulation as never) : null}, ${receipt.policy}, ${receipt.createdAt})
      `;
    } catch {
      // fall through to memory
    }
  }
  if (receipts.size >= MEMORY_CAP) {
    const first = receipts.keys().next().value;
    if (first) receipts.delete(first);
  }
  receipts.set(receipt.id, receipt);
  return receipt;
}

export async function receiptsForHire(chainId: number, hireId: string, limit = 50): Promise<Receipt[]> {
  const db = (await ensureTable().then((ok) => (ok ? sql : null)));
  if (db) {
    try {
      const rows = await db`
        select * from execution_receipt where chain_id = ${chainId} and hire_id = ${hireId}
        order by created_at desc limit ${limit}
      `;
      return (rows as any[]).map(rowToReceipt);
    } catch {
      // fall through
    }
  }
  return [...receipts.values()]
    .filter((r) => r.chainId === chainId && r.hireId === hireId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function receiptsForAgent(agent: string, limit = 50): Promise<Receipt[]> {  const db = (await ensureTable().then((ok) => (ok ? sql : null)));
  if (db) {
    try {
      const rows = await db`
        select * from execution_receipt where lower(agent) = ${agent.toLowerCase()}
        order by created_at desc limit ${limit}
      `;
      return (rows as any[]).map(rowToReceipt);
    } catch {
      // fall through
    }
  }
  return [...receipts.values()]
    .filter((r) => r.agent.toLowerCase() === agent.toLowerCase())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function receiptById(id: string): Promise<Receipt | null> {
  const db = (await ensureTable().then((ok) => (ok ? sql : null)));
  if (db) {
    try {
      const rows = await db`select * from execution_receipt where id = ${id} limit 1`;
      if ((rows as any[]).length > 0) return rowToReceipt((rows as any[])[0]);
    } catch {
      // fall through
    }
  }
  return receipts.get(id) ?? null;
}

function rowToReceipt(row: any): Receipt {
  return {
    id: row.id,
    chainId: Number(row.chain_id),
    hireId: row.hire_id,
    agent: row.agent,
    status: row.status,
    reason: row.reason,
    txHash: row.tx_hash,
    blockNumber: row.block_number != null ? Number(row.block_number) : null,
    before: row.before_state ?? null,
    after: row.after_state ?? null,
    trigger: row.trigger_facts ?? null,
    guardrail: row.guardrail ?? null,
    simulation: row.simulation ?? null,
    policy: row.policy,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
