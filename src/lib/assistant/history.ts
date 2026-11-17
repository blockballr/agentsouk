// the last few turns of each conversation, so the assistant remembers what was just said.
// keyed by conversation (a telegram chat, or a web session); without a database it lives in memory

import "server-only";
import postgres from "postgres";
import type { AssistantMessage } from "./brain";

const KEEP = 12;
let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 10 });

const memory = new Map<string, AssistantMessage[]>();
let ready: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  ready ??= (async () => {
    try {
      await sql!`
        create table if not exists assistant_history (
          id bigserial primary key,
          conversation text not null,
          role text not null,
          content text not null,
          at timestamptz not null default now()
        )
      `;
      await sql!`create index if not exists assistant_history_conv on assistant_history (conversation, id desc)`;
      return true;
    } catch {
      ready = null;
      return false;
    }
  })();
  return ready;
}

export async function loadHistory(conversation: string): Promise<AssistantMessage[]> {
  if (await ensureTable()) {
    const rows = await sql!`
      select role, content from assistant_history where conversation = ${conversation}
      order by id desc limit ${KEEP}
    `;
    return rows.reverse().map((r) => ({ role: r.role === "assistant" ? "assistant" : "user", content: String(r.content) }));
  }
  return [...(memory.get(conversation) ?? [])];
}

export async function appendHistory(conversation: string, turns: AssistantMessage[]): Promise<void> {
  if (await ensureTable()) {
    for (const t of turns) {
      await sql!`insert into assistant_history (conversation, role, content) values (${conversation}, ${t.role}, ${t.content.slice(0, 4000)})`;
    }
    return;
  }
  memory.set(conversation, [...(memory.get(conversation) ?? []), ...turns].slice(-KEEP));
}
