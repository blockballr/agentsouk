// Admit one registered token onto the shared shelf from its upstream detail
// record, in the exact payload shape the admission path writes. Use when the
// refresh gate refuses a record the marketplace would stand behind and the
// code fix is not deployed yet.
//
// usage: node scripts/admit-listing.mjs <chainId> <tokenId>
// DATABASE_URL comes from the environment or the local env backup. It is never
// printed, never copied into the tree.

import postgres from "postgres";
import { readFileSync } from "node:fs";

const BASE = "https://8004scan.io/api/v1/public";

const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);

function databaseUrl() {
  const raw = process.env.DATABASE_URL ?? (() => {
    const backup = "C:/Users/user/Desktop/in-house/env-local-backup-2026-09-29.txt";
    for (const line of readFileSync(backup, "utf8").split(/\r?\n/)) {
      const m = line.match(/^DATABASE_URL=(.*)$/);
      if (m && m[1].trim() !== "") return m[1].trim();
    }
    return null;
  })();
  // the pooler URL carries channel_binding=require, a libpq-only option that
  // node-postgres cannot honor and the handshake resets over it; sslmode=require alone
  return (raw ?? "").replace(/[?&]channel_binding=require/, "") || null;
}

async function detail(chainId, tokenId) {
  const headers = process.env.SCAN_API_KEY ? { "X-API-Key": process.env.SCAN_API_KEY } : {};
  const res = await fetch(`${BASE}/agents/${chainId}/${tokenId}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`upstream detail ${res.status}`);
  const body = await res.json();
  if (!body.success) throw new Error("the upstream answered success false");
  return body.data;
}

// mirrors summaryFromDetail in src/lib/agent-index.ts, which the refresh
// admission also uses; category comes from the upstream classification
function summaryFromDetail(d) {
  const category = (d.categories ?? []).find((c) => c !== "general") ?? "general";
  return {
    agent_id: d.agent_id,
    token_id: String(d.token_id),
    chain_id: d.chain_id,
    contract_address: d.contract_address,
    owner_address: d.owner_address,
    name: d.name,
    description: d.description ?? null,
    image_url: d.image_url ?? null,
    is_verified: !!d.is_verified,
    star_count: 0,
    x402_supported: !!d.x402_supported,
    total_score: d.total_score ?? 0,
    average_score: d.average_score ?? 0,
    total_feedbacks: d.total_feedbacks ?? 0,
    health_score: d.health_score ?? null,
    supported_trust_models: Array.isArray(d.supported_trust_models) ? d.supported_trust_models : [],
    a2a_endpoint: str(d.a2a_endpoint),
    mcp_server: str(d.mcp_server),
    web_endpoint: str(d.web_endpoint),
    is_active: d.is_active ?? true,
    created_at: d.created_at,
    category,
    categoryScores: null,
    ...(Array.isArray(d.skills) && d.skills.length > 0 ? { skills: d.skills } : {}),
  };
}

const [chainIdArg, tokenIdArg] = process.argv.slice(2);
if (!chainIdArg || !tokenIdArg) {
  console.error("usage: node scripts/admit-listing.mjs <chainId> <tokenId>");
  process.exit(1);
}
const chainId = Number(chainIdArg);

const url = databaseUrl();
if (!url) {
  console.error("no DATABASE_URL found: set it, or keep the env backup reachable");
  process.exit(1);
}
const sql = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 30 });

try {
  const d = await detail(chainId, tokenIdArg);
  if (d.chain_id !== chainId) throw new Error(`upstream record is chain ${d.chain_id}, not ${chainId}`);
  const summary = summaryFromDetail(d);
  await sql`
    insert into shelf_agents (chain_id, token_id, payload, updated_at)
    values (${chainId}, ${tokenIdArg}, ${sql.json(summary)}, now())
    on conflict (chain_id, token_id) do update set
      payload = excluded.payload,
      updated_at = now()
  `;
  console.log(
    `admitted ${tokenIdArg} on chain ${chainId}: category ${summary.category},` +
      ` a2a ${summary.a2a_endpoint ?? "none"}, web ${summary.web_endpoint ?? "none"}`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
