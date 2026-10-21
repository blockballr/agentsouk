import "server-only";
import postgres from "postgres";
import { generateSecret } from "./mfa";

let sql: ReturnType<typeof postgres> | null = null;

function db(): ReturnType<typeof postgres> | null {
  if (!process.env.DATABASE_URL) return null;
  if (sql) return sql;
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 });
  return sql;
}

async function init(): Promise<boolean> {
  const s = db();
  if (!s) return false;
  try {
    await s`
      create table if not exists mfa_secrets (
        wallet text primary key,
        secret text not null,
        enabled boolean not null default false,
        created_at timestamptz not null default now()
      )
    `;
    return true;
  } catch {
    return false;
  }
}

export async function enrolMfa(wallet: string): Promise<string | null> {
  const s = db();
  if (!s || !(await init())) return null;
  const w = wallet.toLowerCase();
  const secret = generateSecret();
  try {
    await s`
      insert into mfa_secrets (wallet, secret, enabled)
      values (${w}, ${secret}, false)
      on conflict (wallet) do update set secret = ${secret}, enabled = false
    `;
    return secret;
  } catch {
    return null;
  }
}

export async function getMfaSecret(wallet: string): Promise<string | null> {
  const s = db();
  if (!s || !(await init())) return null;
  try {
    const rows = await s`select secret from mfa_secrets where wallet = ${wallet.toLowerCase()}`;
    return rows[0]?.secret ?? null;
  } catch {
    return null;
  }
}

export async function setMfaEnabled(wallet: string, enabled: boolean): Promise<boolean> {
  const s = db();
  if (!s || !(await init())) return false;
  try {
    await s`update mfa_secrets set enabled = ${enabled} where wallet = ${wallet.toLowerCase()}`;
    return true;
  } catch {
    return false;
  }
}

export async function isMfaEnabled(wallet: string): Promise<boolean> {
  const s = db();
  if (!s || !(await init())) return false;
  try {
    const rows = await s`select enabled from mfa_secrets where wallet = ${wallet.toLowerCase()}`;
    return rows[0]?.enabled ?? false;
  } catch {
    return false;
  }
}
