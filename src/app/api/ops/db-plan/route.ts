import { NextRequest, NextResponse } from "next/server";
import postgres from "postgres";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ error: "no database" }, { status: 503 });

  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    const chainId = Number(req.nextUrl.searchParams.get("chain") ?? 56);
    const plan = await sql`
      explain (analyze, buffers, format json)
      select chain_id, token_id, payload, updated_at
      from shelf_agents
      where chain_id = ${chainId}
      order by updated_at desc
    `;
    const indexes = await sql`
      select indexname, indexdef from pg_indexes where tablename = 'shelf_agents'
    `;
    const sizes = await sql`
      select relname, n_live_tup, pg_total_relation_size(relid) as bytes
      from pg_stat_user_tables
      where relname in ('shelf_agents', 'receipts', 'verifications', 'boosts', 'listing_edits')
    `;
    return NextResponse.json({ chainId, plan, indexes, sizes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
