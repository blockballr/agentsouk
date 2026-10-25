// Durable store for hirer-funded action receipts. Postgres when DATABASE_URL is
// set, in-memory fallback otherwise. Mirrors src/lib/builder/custom.ts.

import "server-only";

import postgres from "postgres";

const sql = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 })
  : null;

export interface HirerReceipt {
  id: string;
  hireId: string;
  agentId: string;
  hirer: string;
  action: string;
  venue: string;
  txHash: string;
  amount: string;
  chainId: number;
  status: "executed" | "failed";
  createdAt: string;
}

const memory = new Map<string, HirerReceipt>();
let tableReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists custom_hirer_receipts (
          id text primary key,
          hire_id text not null,
          agent_id text not null,
          hirer text not null,
          action text not null,
          venue text not null,
          tx_hash text not null,
          amount text not null,
          chain_id integer not null,
          status text not null,
          created_at timestamptz not null default now()
        )
      `;
      await sql!`create index if not exists custom_hirer_receipts_hirer on custom_hirer_receipts (hirer, created_at desc)`;
      await sql!`create index if not exists custom_hirer_receipts_agent on custom_hirer_receipts (agent_id, created_at desc)`;
      await sql!`create index if not exists custom_hirer_receipts_hire on custom_hirer_receipts (hire_id, created_at desc)`;
      return true;
    } catch {
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

async function store(): Promise<typeof sql> {
  if (!sql) return null;
  if (!(await ensureTable())) throw new Error("hirer receipts store unavailable");
  return sql;
}

type Row = {
  id: string;
  hire_id: string;
  agent_id: string;
  hirer: string;
  action: string;
  venue: string;
  tx_hash: string;
  amount: string;
  chain_id: number;
  status: string;
  created_at: Date | string;
};

function fromRow(row: Row): HirerReceipt {
  return {
    id: row.id,
    hireId: row.hire_id,
    agentId: row.agent_id,
    hirer: row.hirer,
    action: row.action,
    venue: row.venue,
    txHash: row.tx_hash,
    amount: row.amount,
    chainId: row.chain_id,
    status: row.status === "executed" ? "executed" : "failed",
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(row.created_at).toISOString(),
  };
}

export async function saveHirerReceipt(r: HirerReceipt): Promise<void> {
  memory.set(r.id, r);
  const s = await store().catch(() => null);
  if (!s) return;
  try {
    await s`
      insert into custom_hirer_receipts (id, hire_id, agent_id, hirer, action, venue, tx_hash, amount, chain_id, status, created_at)
      values (${r.id}, ${r.hireId}, ${r.agentId}, ${r.hirer.toLowerCase()}, ${r.action}, ${r.venue}, ${r.txHash}, ${r.amount}, ${r.chainId}, ${r.status}, ${r.createdAt})
      on conflict (id) do nothing
    `;
  } catch {
    // memory already holds it
  }
}

export async function listHirerReceipts(filter: { hireId?: string; agentId?: string; hirer?: string }): Promise<HirerReceipt[]> {
  // merge memory + db
  const out = new Map<string, HirerReceipt>();
  for (const r of memory.values()) {
    if (filter.hireId && r.hireId !== filter.hireId) continue;
    if (filter.agentId && r.agentId !== filter.agentId) continue;
    if (filter.hirer && r.hirer.toLowerCase() !== filter.hirer.toLowerCase()) continue;
    out.set(r.id, r);
  }
  const s = await store().catch(() => null);
  if (s) {
    try {
      const rows = (await s`
        select * from custom_hirer_receipts
        where (${filter.hireId ?? null}::text is null or hire_id = ${filter.hireId ?? null})
          and (${filter.agentId ?? null}::text is null or agent_id = ${filter.agentId ?? null})
          and (${filter.hirer ?? null}::text is null or hirer = ${filter.hirer ? filter.hirer.toLowerCase() : null})
        order by created_at desc
        limit 200
      `) as Row[];
      for (const row of rows) {
        const r = fromRow(row);
        out.set(r.id, r);
      }
    } catch {
      // memory only
    }
  }
  return [...out.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
