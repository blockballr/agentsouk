// One Postgres pool per serverless instance, shared by every store. A cold
// shelf request used to open one connection per store it touched, six or more
// handshakes before the first row came back; they now share this client, so a
// cold request pays for one connection.
import "server-only";
import postgres from "postgres";

export type DbClient = ReturnType<typeof postgres>;
type Client = DbClient;

// route bundles and the dev server can evaluate this module more than once, so
// the pool lives on globalThis: a process reuses one client whichever chunk
// asks first, and a hot reload does not leak a second pool
const holder = globalThis as unknown as { __soukDb?: Client | null };

export function dbClient(): Client | null {
  if (holder.__soukDb !== undefined) return holder.__soukDb;
  const url = process.env.DATABASE_URL;
  holder.__soukDb = url
    ? postgres(url, {
        // a shelf request fans out to several stores at once, so a single slot
        // would queue them behind each other
        max: 4,
        idle_timeout: 20,
        connect_timeout: 5,
        // callers sometimes pass undefined where a column allows null; the old
        // per-store clients coerced that, and dropping it here would turn a
        // tolerated call into a throw
        transform: { undefined: null },
      })
    : null;
  return holder.__soukDb;
}
