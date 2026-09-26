// Delivery verification for the 21 chain 97 agents, mirroring
// src/lib/delivery.ts deliverA2a exactly: fetch the registered agent card, take
// the messaging url from supportedInterfaces[0].url or url, then POST an A2A
// message/send and classify the outcome.
//
// This is the same read plus message/send our own product performs on hire, run
// across the whole catalogue instead of one agent at a time. It is what decides
// whether the marketplace can lead with agents that actually deliver.
import { readFileSync, writeFileSync } from "node:fs";

const snapshot = JSON.parse(readFileSync(new URL("../data/agents-97.json", import.meta.url), "utf8"));
const OUT = new URL("./chain97-delivery-probe.json", import.meta.url);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// a neutral, benign capability question, the kind a buyer would ask
const TASK =
  "Capability check from Agent Souk. Reply with one line naming what you do and the input you need to do it. No funds are attached to this message.";

function classify(status, body) {
  if (status === 402) return { status: "gated", detail: "agent gates direct calls behind its own x402 payment" };
  if (body?.error) return { status: "error", detail: `message/send failed: ${body.error.message}` };
  const parts = body?.result?.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  if (text) return { status: "delivers", detail: text.slice(0, 300) };
  if (body?.result) return { status: "delivers", detail: JSON.stringify(body.result).slice(0, 300) };
  return { status: "empty", detail: "responded but returned no text" };
}

const results = [];

for (const a of snapshot.agents) {
  const card = a.a2a_endpoint || a.mcp_server || a.agent_url;
  const row = {
    tokenId: a.token_id,
    name: a.name,
    category: a.category,
    endpoint: card ?? null,
    registryHealth: a.health_status,
    endpointVerified: a.is_endpoint_verified,
  };

  if (!card) {
    row.status = "no_endpoint";
    row.detail = "no MCP server, A2A endpoint or agent url in the registry record";
    results.push(row);
    console.log(`${String(a.token_id).padEnd(7)} ${(a.category ?? "").padEnd(15)} no_endpoint`);
    continue;
  }

  let messagingUrl = card;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const res = await fetch(card, { headers: { accept: "application/json", "user-agent": UA }, signal: ctl.signal }).finally(() =>
      clearTimeout(timer),
    );
    const parsed = await res.json();
    const fromCard = parsed?.supportedInterfaces?.[0]?.url ?? parsed?.url;
    if (fromCard) messagingUrl = fromCard;
    row.messagingUrl = messagingUrl;
  } catch (e) {
    row.status = "card_unreachable";
    row.detail = String(e.message || e).slice(0, 120);
    results.push(row);
    console.log(`${String(a.token_id).padEnd(7)} ${(a.category ?? "").padEnd(15)} card_unreachable`);
    continue;
  }

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(messagingUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            kind: "message",
            messageId: `agora-probe-${a.token_id}`,
            parts: [{ kind: "text", text: TASK }],
          },
        },
      }),
      signal: ctl.signal,
    }).finally(() => clearTimeout(timer));

    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    Object.assign(row, classify(res.status, body), { httpStatus: res.status });
    if (!body && text) row.detail = `non json response: ${text.slice(0, 160)}`;
  } catch (e) {
    row.status = "unreachable";
    row.detail = String(e.message || e).slice(0, 120);
  }

  results.push(row);
  console.log(`${String(a.token_id).padEnd(7)} ${(a.category ?? "").padEnd(15)} ${row.status.padEnd(18)} ${(row.detail ?? "").slice(0, 90)}`);
}

const byStatus = {};
const byCategory = {};
for (const r of results) {
  byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const c = r.category ?? "uncategorised";
  if (!byCategory[c]) byCategory[c] = { total: 0, delivers: 0 };
  byCategory[c].total += 1;
  if (r.status === "delivers") byCategory[c].delivers += 1;
}

writeFileSync(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), chainId: 97, results }, null, 2) + "\n", "utf8");

console.log("\n=== status totals ===");
for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`);
console.log("\n=== delivers per category ===");
for (const [c, d] of Object.entries(byCategory).sort()) console.log(`  ${c.padEnd(16)} ${d.delivers}/${d.total}`);
