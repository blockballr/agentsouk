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
      await sql`create table if not exists telegram_mute (telegram_id text primary key, muted_at timestamptz not null default now())`;
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

const muteMemory = new Set();

// a muted chat still talks to the assistant; it only stops receiving notifications
export async function setMuted(telegramId, muted) {
  const id = String(telegramId);
  if (sql && (await ensureTables())) {
    if (muted) await sql`insert into telegram_mute (telegram_id) values (${id}) on conflict do nothing`;
    else await sql`delete from telegram_mute where telegram_id = ${id}`;
    return;
  }
  if (muted) muteMemory.add(id);
  else muteMemory.delete(id);
}

export async function isMuted(telegramId) {
  const id = String(telegramId);
  if (sql && (await ensureTables())) {
    const rows = await sql`select 1 from telegram_mute where telegram_id = ${id}`;
    return rows.length > 0;
  }
  return muteMemory.has(id);
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

export async function listTelegramLinks() {
  if (sql && (await ensureTables())) {
    try {
      const rows = await sql`select telegram_id, wallet from telegram_link`;
      return rows.map((row) => ({ telegramId: row.telegram_id, wallet: row.wallet }));
    } catch {
      // fall through
    }
  }
  return [...memory.values()].map((row) => ({ telegramId: row.telegramId, wallet: row.wallet }));
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

// the other direction: the website asks for a code bound to a wallet, the user opens the bot with
// it, and /start <code> links that chat. a code works once, for fifteen minutes
const walletCodeMemory = new Map();

async function ensureWalletCodes() {
  if (!(await ensureTables())) return false;
  try {
    await sql`
      create table if not exists telegram_wallet_code (
        code text primary key,
        wallet text not null,
        expires_at timestamptz not null,
        used_at timestamptz
      )`;
    return true;
  } catch {
    return false;
  }
}

export async function createWalletCode(wallet) {
  const code = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const address = wallet.toLowerCase();
  if (sql) {
    if (!(await ensureWalletCodes())) return null;
    await sql`insert into telegram_wallet_code (code, wallet, expires_at) values (${code}, ${address}, ${expiresAt})`;
    return { code, expiresAt };
  }
  walletCodeMemory.set(code, { wallet: address, expiresAt, usedAt: null });
  return { code, expiresAt };
}

export async function consumeWalletCode(code) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return null;
  const now = Date.now();
  if (sql) {
    if (!(await ensureWalletCodes())) return null;
    const rows = await sql`
      update telegram_wallet_code set used_at = now()
      where code = ${code} and used_at is null and expires_at > now()
      returning wallet`;
    return rows[0]?.wallet ?? null;
  }
  const row = walletCodeMemory.get(code);
  if (!row || row.usedAt || Date.parse(row.expiresAt) < now) return null;
  row.usedAt = new Date().toISOString();
  return row.wallet;
}

export async function linkForWallet(wallet) {
  const address = wallet.toLowerCase();
  if (sql && (await ensureTables())) {
    const rows = await sql`
      select telegram_id, username from telegram_link
      where lower(wallet) = ${address}
      order by linked_at desc
      limit 1`;
    const row = rows[0];
    return row ? { telegramId: row.telegram_id, username: row.username ?? null } : null;
  }
  for (const row of memory.values()) {
    if (row.wallet === address) return { telegramId: row.telegramId, username: row.username ?? null };
  }
  return null;
}

export async function unlinkWallet(wallet) {
  const address = wallet.toLowerCase();
  if (sql && (await ensureTables())) {
    const rows = await sql`delete from telegram_link where lower(wallet) = ${address} returning telegram_id`;
    return rows.length;
  }
  let removed = 0;
  for (const [id, row] of memory) {
    if (row.wallet === address) {
      memory.delete(id);
      removed += 1;
    }
  }
  return removed;
}
