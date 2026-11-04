// One Telegram account to one wallet. Postgres when DATABASE_URL is set, memory
// otherwise, so the service starts without a database and never loses the
// production link by pretending memory is enough.

import postgres from "postgres";
import { randomBytes } from "node:crypto";

let sql = null;
if (process.env.DATABASE_URL) {
  // the pooler url carries a libpq-only option node-postgres cannot honor
  const url = process.env.DATABASE_URL.replace(/[?&]channel_binding=require/, "");
  sql = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 5 });
}

const memory = new Map();
const codeMemory = new Map();
let tablesReady = null;

async function ensureTables() {
  if (!sql) return false;
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    try {
      await sql`
        create table if not exists telegram_link (
          telegram_id text primary key,
          wallet text not null,
          username text,
          linked_at timestamptz not null default now()
        )`;
      await sql`create index if not exists telegram_link_wallet_idx on telegram_link (lower(wallet))`;
      await sql`
        create table if not exists telegram_link_code (
          code text primary key,
          telegram_id text not null,
          expires_at timestamptz not null,
          used_at timestamptz
        )`;
      return true;
    } catch (e) {
      console.error("telegram store", e instanceof Error ? e.message : String(e));
      return false;
    }
  })();
  return tablesReady;
}

export async function linkTelegram(input) {
  const row = {
    telegramId: input.telegramId,
    wallet: input.wallet.toLowerCase(),
    username: input.username ?? null,
    linkedAt: new Date().toISOString(),
  };

  if (sql) {
    if (!(await ensureTables())) return { ok: false, error: "the link store is not available" };
    try {
      await sql`
        insert into telegram_link (telegram_id, wallet, username, linked_at)
        values (${row.telegramId}, ${row.wallet}, ${row.username}, now())
        on conflict (telegram_id) do update set
          wallet = excluded.wallet,
          username = excluded.username,
          linked_at = now()`;
    } catch {
      return { ok: false, error: "could not save the link" };
    }
  }

  memory.set(row.telegramId, row);
  return { ok: true };
}

export async function walletForTelegram(telegramId) {
  if (sql && (await ensureTables())) {
    try {
      const rows = await sql`select wallet from telegram_link where telegram_id = ${telegramId}`;
      const row = rows[0];
      if (row) return row.wallet;
    } catch {
      // fall through to the memory row
    }
  }
  return memory.get(telegramId)?.wallet ?? null;
}

export async function telegramForWallet(wallet) {
  const address = wallet.toLowerCase();
  if (sql && (await ensureTables())) {
    try {
      const rows = await sql`
        select telegram_id from telegram_link
        where lower(wallet) = ${address}
        order by linked_at desc
        limit 1`;
      const row = rows[0];
      if (row) return row.telegram_id;
    } catch {
      // fall through
    }
  }
  for (const row of memory.values()) {
    if (row.wallet === address) return row.telegramId;
  }
  return null;
}

// a short code lets the wallet be linked from a normal browser, where the
// WalletConnect handoff is not blocked by Telegram's webview
export async function createLinkCode(telegramId) {
  const code = randomBytes(4).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  if (sql && (await ensureTables())) {
    try {
      await sql`
        insert into telegram_link_code (code, telegram_id, expires_at)
        values (${code}, ${telegramId}, ${expiresAt})`;
    } catch (e) {
      console.error("telegram code", e instanceof Error ? e.message : String(e));
      return null;
    }
  }
  codeMemory.set(code, { telegramId, expiresAt, usedAt: null });
  return { code, expiresAt };
}

export async function consumeLinkCode(code) {
  const now = Date.now();
  if (sql && (await ensureTables())) {
    try {
      const rows = await sql`
        select telegram_id, expires_at, used_at from telegram_link_code where code = ${code}`;
      const row = rows[0];
      if (!row || row.used_at || new Date(row.expires_at).getTime() < now) return null;
      await sql`update telegram_link_code set used_at = now() where code = ${code} and used_at is null`;
      return row.telegram_id;
    } catch {
      // fall through to the memory row
    }
  }
  const row = codeMemory.get(code);
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() < now) return null;
  row.usedAt = new Date().toISOString();
  return row.telegramId;
}
