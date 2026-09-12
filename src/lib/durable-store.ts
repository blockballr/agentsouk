// durable postgres backing for hire tasks and ERC-8183 jobs, enabled by RECEIPTS_STORE=postgres
// and DATABASE_URL; write-through from the in-memory stores, which remain the cache and fallback

import "server-only";
import postgres from "postgres";
import type { HireTask } from "./tasks";
import type { Job } from "./jobs";

const sql =
  process.env.DATABASE_URL && process.env.RECEIPTS_STORE === "postgres"
    ? postgres(process.env.DATABASE_URL, {
        max: 1,
        idle_timeout: 20,
        connect_timeout: 5,
      })
    : null;

let initPromise: Promise<boolean> | null = null;
let ready = false;

export function durableMode(): "postgres" | "memory" {
  return sql ? "postgres" : "memory";
}

async function init(): Promise<boolean> {
  if (!sql) return false;
  if (ready) return true;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await Promise.race([
          sql!`
            create table if not exists hire_tasks (
              id text primary key,
              payment_id text not null,
              payload jsonb not null,
              updated_at timestamptz default now()
            )
          `,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("tasks db timeout")), 4000),
          ),
        ]);
        await sql!`
          create index if not exists hire_tasks_payment_idx on hire_tasks (payment_id)
        `;
        await sql!`
          create table if not exists jobs (
            id text primary key,
            payment_id text,
            client text,
            payload jsonb not null,
            updated_at timestamptz default now()
          )
        `;
        await sql!`
          create index if not exists jobs_payment_idx on jobs (payment_id)
        `;
        await sql!`
          create index if not exists jobs_client_idx on jobs (client)
        `;
        ready = true;
        return true;
      } catch {
        initPromise = null;
        ready = false;
        return false;
      }
    })();
  }
  return initPromise;
}

export async function saveHireTask(task: HireTask): Promise<void> {
  if (!(await init()) || !sql) return;
  try {
    await sql`
      insert into hire_tasks (id, payment_id, payload, updated_at)
      values (${task.id}, ${task.paymentId}, ${sql.json(task as never)}, now())
      on conflict (id) do update set
        payment_id = excluded.payment_id,
        payload = excluded.payload,
        updated_at = now()
    `;
  } catch {
  }
}

export async function loadHireTask(id: string): Promise<HireTask | undefined> {
  if (!(await init()) || !sql) return undefined;
  try {
    const rows = await sql`
      select payload from hire_tasks where id = ${id} limit 1
    `;
    return rows[0]?.payload as HireTask | undefined;
  } catch {
    return undefined;
  }
}

export async function loadHireTaskByPayment(
  paymentId: string,
): Promise<HireTask | undefined> {
  if (!(await init()) || !sql) return undefined;
  try {
    const rows = await sql`
      select payload from hire_tasks
      where payment_id = ${paymentId}
      order by updated_at desc
      limit 1
    `;
    return rows[0]?.payload as HireTask | undefined;
  } catch {
    return undefined;
  }
}

export async function loadHireTasks(limit = 100): Promise<HireTask[]> {
  if (!(await init()) || !sql) return [];
  try {
    const rows = await sql`
      select payload from hire_tasks
      order by updated_at desc
      limit ${limit}
    `;
    return rows.map((r) => r.payload as HireTask);
  } catch {
    return [];
  }
}

export async function saveJob(job: Job): Promise<void> {
  if (!(await init()) || !sql) return;
  try {
    await sql`
      insert into jobs (id, payment_id, client, payload, updated_at)
      values (
        ${job.id},
        ${job.paymentId ?? null},
        ${job.client},
        ${sql.json(job as never)},
        now()
      )
      on conflict (id) do update set
        payment_id = excluded.payment_id,
        client = excluded.client,
        payload = excluded.payload,
        updated_at = now()
    `;
  } catch {
  }
}

export async function loadJob(id: string): Promise<Job | undefined> {
  if (!(await init()) || !sql) return undefined;
  try {
    const rows = await sql`
      select payload from jobs where id = ${id} limit 1
    `;
    return rows[0]?.payload as Job | undefined;
  } catch {
    return undefined;
  }
}

export async function loadJobByPayment(
  paymentId: string,
): Promise<Job | undefined> {
  if (!(await init()) || !sql) return undefined;
  try {
    const rows = await sql`
      select payload from jobs
      where payment_id = ${paymentId}
      order by updated_at desc
      limit 1
    `;
    return rows[0]?.payload as Job | undefined;
  } catch {
    return undefined;
  }
}

export async function loadJobs(limit = 100): Promise<Job[]> {
  if (!(await init()) || !sql) return [];
  try {
    const rows = await sql`
      select payload from jobs
      order by updated_at desc
      limit ${limit}
    `;
    return rows.map((r) => r.payload as Job);
  } catch {
    return [];
  }
}

export async function loadJobsByClient(
  client: string,
  limit = 100,
): Promise<Job[]> {
  if (!(await init()) || !sql) return [];
  try {
    const rows = await sql`
      select payload from jobs
      where lower(client) = lower(${client})
      order by updated_at desc
      limit ${limit}
    `;
    return rows.map((r) => r.payload as Job);
  } catch {
    return [];
  }
}
