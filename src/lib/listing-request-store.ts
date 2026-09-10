// listing review request store. in-memory list is the source of truth for
// tests and for deployments without a database; when DATABASE_URL is set the
// requests are also persisted to postgres (best-effort, never throws).
// the postgres driver is imported lazily so this module stays importable
// from plain node checks.

export interface StoredListingRequest {
  tokenId: string;
  contact: string;
  note: string;
  createdAt: string;
}

const memory: StoredListingRequest[] = [];

let tableReady: Promise<boolean> | null = null;

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
            contact text not null,
            note text not null default '',
            created_at timestamptz default now()
          )
        `;
        return true;
      } catch {
        tableReady = null;
        return false;
      }
    })();
  }
  return tableReady;
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
    await sql`
      insert into listing_requests (token_id, contact, note, created_at)
      values (${req.tokenId}, ${req.contact}, ${req.note}, ${req.createdAt})
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
