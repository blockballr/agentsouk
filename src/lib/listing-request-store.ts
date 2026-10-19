// listing review request store. in-memory list is the source of truth for
// tests and for deployments without a database; when DATABASE_URL is set the
// requests are also persisted to postgres (best-effort, never throws).
// the postgres driver is imported lazily so this module stays importable
// from plain node checks.

export interface StoredListingRequest {
  tokenId: string;
  email: string;
  telegram: string;
  note: string;
  createdAt: string;
}

const memory: StoredListingRequest[] = [];

let tableReady: Promise<boolean> | null = null;

// the original table carried one free-form `contact`; the queue now asks for an
// email and a Telegram handle separately. Existing rows keep their contact
// value, so the pair is added alongside it rather than replacing it.
async function ensureTable(sql: unknown): Promise<boolean> {
  if (!tableReady) {
    tableReady = (async () => {
      try {
        const db = sql as {
          (t: TemplateStringsArray, ...v: unknown[]): Promise<unknown>;
        };
        await db`
          create table if not exists listing_requests (
            id bigserial primary key,
            token_id text not null,
            contact text not null default '',
            email text not null default '',
            telegram text not null default '',
            note text not null default '',
            created_at timestamptz default now()
          )
        `;
        await db`alter table listing_requests add column if not exists email text not null default ''`;
        await db`alter table listing_requests add column if not exists telegram text not null default ''`;
        return true;
      } catch {
        tableReady = null;
        return false;
      }
    })();
  }
  return tableReady;
}

// old rows only hold `contact`, so a read splits it when the new columns are
// empty. An address is the part with an @ and a dot; anything else was a handle.
function fromLegacyContact(contact: string): { email: string; telegram: string } {
  const value = contact.trim();
  if (!value) return { email: '', telegram: '' };
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? { email: value, telegram: '' }
    : { email: '', telegram: value };
}

async function persist(req: StoredListingRequest): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const mod = (await import("postgres")) as unknown as {
      default: (url: string, opts?: object) => unknown;
    };
    const sql = mod.default(process.env.DATABASE_URL, { max: 1, idle_timeout: 20 }) as {
      (t: TemplateStringsArray, ...v: unknown[]): Promise<unknown>;
      json: (v: unknown) => unknown;
    };
    if (!(await ensureTable(sql))) return;
    // keep contact populated for any older reader of the table
    const contact = [req.email, req.telegram].filter(Boolean).join(" / ");
    await sql`
      insert into listing_requests (token_id, contact, email, telegram, note, created_at)
      values (${req.tokenId}, ${contact}, ${req.email}, ${req.telegram}, ${req.note}, ${req.createdAt})
    `;
  } catch {
    // persistence is best-effort; the memory list still holds the request
  }
}

export async function recordListingRequest(req: StoredListingRequest): Promise<boolean> {
  memory.push(req);
  await persist(req);
  return true;
}

export async function listListingRequests(): Promise<StoredListingRequest[]> {
  return [...memory];
}

// The durable read behind the team's queue. Postgres holds what every instance
// received, so the queue is complete rather than whatever this instance served;
// the in-memory list is the fallback when no database is configured.
export async function readListingRequests(limit = 50): Promise<StoredListingRequest[]> {
  const capped = Math.min(200, Math.max(1, Math.floor(limit)));
  if (process.env.DATABASE_URL) {
    try {
      const mod = (await import("postgres")) as unknown as {
        default: (url: string, opts?: object) => unknown;
      };
      const sql = mod.default(process.env.DATABASE_URL, { max: 1, idle_timeout: 20 }) as {
        (t: TemplateStringsArray, ...v: unknown[]): Promise<unknown>;
      };
      if (await ensureTable(sql)) {
        const rows = (await sql`
          select token_id, contact, email, telegram, note, created_at
          from listing_requests
          order by created_at desc, id desc
          limit ${capped}
        `) as {
          token_id: string;
          contact: string;
          email: string;
          telegram: string;
          note: string;
          created_at: string | Date;
        }[];
        return rows.map((r) => {
          const legacy = fromLegacyContact(r.contact ?? "");
          return {
            tokenId: r.token_id,
            email: (r.email ?? "").trim() || legacy.email,
            telegram: (r.telegram ?? "").trim() || legacy.telegram,
            note: r.note,
            createdAt: new Date(r.created_at).toISOString(),
          };
        });
      }
    } catch {
      // fall through to the in-memory list rather than failing the read
    }
  }
  return [...memory]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, capped);
}
