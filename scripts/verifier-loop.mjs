// Autonomous shopper verification loop: the marketplace hires its own listed
// agents in sandbox mode and records what actually happened.
//
// Usage (server must be running on :3000):
//   node scripts/verifier-loop.mjs
// writes data/verifications.json; agents whose verdicts were not reached
// before the wall clock budget are simply left out (absence is honest)
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const CHAIN_ID = 56;
const AMOUNT_USD = 2;
const BUDGET_MS = 25 * 60 * 1000;
const VERIFY_LIMIT = Math.max(1, Math.min(200, Number(process.env.VERIFY_LIMIT ?? 40) || 40));
const A2A_TASK = "report your status in one sentence";
const GATED_RE = /gates direct calls behind its own x402/i;

// the ai layer: review what the agent actually delivered
// the hire rail above stays deterministic; the model only judges quality
try {
  process.loadEnvFile(".env.local");
} catch {
  // no env file: quality reviews are skipped, deterministic verdicts stand
}
const LLM_EVAL_API_KEY = process.env.LLM_EVAL_API_KEY ?? "";
const PRIMARY_MODEL = process.env.LLM_EVAL_MODEL ?? "gemini-2.5-flash";
const FALLBACK_MODEL = process.env.LLM_EVAL_FALLBACK_MODEL ?? "gemini-2.0-flash";
const BASE_URL = process.env.LLM_EVAL_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";
const LLM_DELAY_MS = 5000;
const GRADES = new Set(["good", "partial", "poor"]);
let lastLlmCallAt = 0;

const wallet = privateKeyToAccount(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);

const startedAt = Date.now();
const timeLeft = () => BUDGET_MS - (Date.now() - startedAt);
const outOfTime = () => timeLeft() <= 0;

const JSON_HEADERS = { "Content-Type": "application/json" };

async function fetchJson(url, opts = {}, timeoutMs = 30000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = { _nonJson: raw.slice(0, 200) };
  }
  return { status: res.status, body };
}

// walk the fresh snapshot, balanced across its own category distribution:
// top scorers per category, capped so the pass totals VERIFY_LIMIT
function candidatesFromSnapshot() {
  const list = JSON.parse(readFileSync(new URL("../data/agents.json", import.meta.url)));
  const byScore = (a, b) => (b.average_score ?? 0) - (a.average_score ?? 0);
  const pools = {};
  for (const a of list.agents) {
    if (a.chain_id !== CHAIN_ID) continue;
    const cat = a.category ?? "general";
    (pools[cat] ??= []).push(a);
  }
  const cats = Object.keys(pools).sort((a, b) => pools[b].length - pools[a].length);
  const perCategory = Math.ceil(VERIFY_LIMIT / cats.length);
  const selected = [];
  for (const cat of cats) {
    for (const a of pools[cat].sort(byScore).slice(0, perCategory)) {
      selected.push({
        chainId: CHAIN_ID,
        tokenId: String(a.token_id),
        name: a.name,
        category: cat,
      });
    }
  }
  return selected.slice(0, VERIFY_LIMIT);
}

async function probeDetail(chainId, tokenId) {
  const res = await fetchJson(`${BASE}/api/agents/${chainId}/${tokenId}`, {}, 45000);
  if (res.status !== 200 || !res.body?.data) return null;
  return res.body.data;
}

// sign-and-settle block from scripts/settle-test.mjs, parameterized per agent
async function settleHire(cand) {
  const reqRes = await fetchJson(`${BASE}/api/x402/requirements`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      chainId: cand.chainId,
      tokenId: cand.tokenId,
      amountUsd: AMOUNT_USD,
      client: wallet.address,
    }),
  });
  const pr = reqRes.body?.data?.paymentRequirements;
  if (reqRes.status !== 200 || !pr) {
    return {
      ok: false,
      detail: `requirements failed (HTTP ${reqRes.status}): ${JSON.stringify(reqRes.body).slice(0, 300)}`,
    };
  }

  const asset = getAddress(pr.asset);
  const payTo = getAddress(pr.payTo);
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const message = {
    from: wallet.address,
    to: payTo,
    value: BigInt(pr.amount),
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + 300),
    nonce,
  };
  const domain = {
    name: pr.extra.name,
    version: pr.extra.version,
    chainId: BigInt(cand.chainId),
    verifyingContract: asset,
  };
  const signature = await wallet.signTypedData({
    domain,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message,
  });

  const resource = {
    url: `/agents/${cand.chainId}/${cand.tokenId}`,
    description: `Hire ${cand.name} for a paid session`,
    mimeType: "application/json",
  };

  const settlePayload = {
    paymentId: `pay_${nonce.slice(2, 20)}`,
    paymentPayload: {
      x402Version: 2,
      payload: {
        authorization: {
          from: wallet.address,
          to: pr.payTo,
          value: message.value.toString(),
          validAfter: message.validAfter.toString(),
          validBefore: message.validBefore.toString(),
          nonce,
          signature,
        },
        resource,
      },
      resource,
      accepted: pr,
    },
    paymentRequirements: pr,
    agent: {
      chainId: cand.chainId,
      tokenId: cand.tokenId,
      name: cand.name,
      symbol: "USDC",
    },
  };

  const settleRes = await fetchJson(`${BASE}/api/x402/settle`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(settlePayload),
  });
  if (!(settleRes.status === 200 && settleRes.body?.success)) {
    return {
      ok: false,
      detail: `settle failed (HTTP ${settleRes.status}): ${JSON.stringify(settleRes.body).slice(0, 300)}`,
    };
  }
  return { ok: true, paymentId: settleRes.body.paymentId };
}

async function deliverJson(paymentId, extra = {}) {
  return fetchJson(
    `${BASE}/api/x402/deliver`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ paymentId, ...extra }),
    },
    60000,
  );
}

async function llmChat(model, task, deliverableText) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_EVAL_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You grade the deliverable an AI agent produced for a task. Reply with JSON only: {"grade":"good"|"partial"|"poor", "reason":"one sentence"}. good = the deliverable answers the task usefully and concretely. partial = partly useful or vague. poor = does not answer the task.',
        },
        { role: "user", content: `Task: ${task}\n\nDeliverable:\n${deliverableText.slice(0, 4000)}` },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("non-json response");
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no message content");
  const fenced = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(fenced);
  if (!GRADES.has(parsed?.grade) || typeof parsed?.reason !== "string") {
    throw new Error("unparseable grade");
  }
  return { grade: parsed.grade, reason: parsed.reason.slice(0, 300), model };
}

// primary model first; on any failure (network, 429, 5xx, unparseable json)
// retry ONCE with the fallback; if both fail return null -> no quality field
async function reviewQuality(task, deliverableText) {
  if (!LLM_EVAL_API_KEY) return null;
  const pace = async () => {
    const wait = lastLlmCallAt + LLM_DELAY_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastLlmCallAt = Date.now();
  };
  try {
    await pace();
    return await llmChat(PRIMARY_MODEL, task, deliverableText);
  } catch {
    try {
      await pace();
      return await llmChat(FALLBACK_MODEL, task, deliverableText);
    } catch {
      return null;
    }
  }
}

async function classify(cand) {
  // unreachable: the registry shows no callable endpoint, or the detail
  // lookup itself failed; nothing to hire
  const detail = await probeDetail(CHAIN_ID, cand.tokenId);
  if (!detail || (!detail.mcp_server && !detail.a2a_endpoint)) {
    return {
      status: "unreachable",
      detail: !detail ? "registry detail unavailable" : "no callable endpoint registered",
    };
  }

  const hire = await settleHire(cand);
  if (!hire.ok) return { status: "dead", detail: hire.detail };

  const cap = await deliverJson(hire.paymentId);
  if (cap.status === 402 || cap.body?.success === false) {
    const err = cap.body?.error ?? `HTTP ${cap.status} ${JSON.stringify(cap.body).slice(0, 200)}`;
    if (GATED_RE.test(err)) return { status: "gated", detail: err };
    return { status: "dead", detail: `deliver failed: ${err}` };
  }
  const d = cap.body?.data;
  if (!d?.ok) {
    return {
      status: "dead",
      detail: `capabilities not ok: ${JSON.stringify(cap.body).slice(0, 300)}`,
    };
  }

  if (d.protocol === "mcp") {
    // generic capability probe only: no tool call for MCP agents
    const tools = d.tools ?? [];
    if (!tools.length) {
      return { status: "dead", detail: "capabilities ok but tools/list returned no tools" };
    }
    return {
      status: "delivered",
      detail: `capabilities ok (${tools.length} tools)`,
      task: "describe the tools you serve",
      deliverable: JSON.stringify(tools, null, 1),
    };
  }

  // a2a: the capabilities probe is an empty handshake; send the short task
  const send = await deliverJson(hire.paymentId, { task: A2A_TASK });
  if (send.status === 402 || send.body?.success === false) {
    const err = send.body?.error ?? `HTTP ${send.status}`;
    if (GATED_RE.test(err)) return { status: "gated", detail: err };
    return { status: "dead", detail: `message/send failed: ${err}` };
  }
  const sd = send.body?.data;
  if (sd?.ok && sd.text) {
    return { status: "delivered", detail: sd.text.slice(0, 300), task: A2A_TASK, deliverable: sd.text };
  }
  return {
    status: "dead",
    detail: `a2a send not ok: ${JSON.stringify(send.body).slice(0, 300)}`,
  };
}

async function main() {
  const candidates = candidatesFromSnapshot();
  console.log(
    `verifying ${candidates.length} candidates (limit ${VERIFY_LIMIT}), budget ${Math.round(BUDGET_MS / 1000)}s`,
  );

  const results = [];
  let skipped = 0;
  const llmStats = { primary: 0, fallback: 0, failed: 0 };

  for (const cand of candidates) {
    if (outOfTime()) {
      skipped += 1;
      continue;
    }
    const line = `[${cand.category}] ${cand.name} (${cand.tokenId})`;
    const t0 = Date.now();
    try {
      const verdict = await classify(cand);
      const result = {
        tokenId: cand.tokenId,
        name: cand.name,
        category: cand.category,
        status: verdict.status,
        responseMs: Date.now() - t0,
        checkedAt: new Date().toISOString(),
      };
      if (verdict.status === "delivered" && !outOfTime()) {
        const quality = await reviewQuality(verdict.task, verdict.deliverable ?? verdict.detail);
        if (quality) {
          result.quality = quality;
          llmStats[quality.model === PRIMARY_MODEL ? "primary" : "fallback"] += 1;
        } else {
          llmStats.failed += 1;
        }
      }
      results.push(result);
      console.log(
        `${line} -> ${verdict.status}` +
          (result.quality ? ` [ai:${result.quality.grade} via ${result.quality.model}]` : "") +
          ` (${Date.now() - t0}ms): ${verdict.detail.slice(0, 120)}`,
      );
    } catch (e) {
      results.push({
        tokenId: cand.tokenId,
        name: cand.name,
        category: cand.category,
        status: "dead",
        responseMs: Date.now() - t0,
        checkedAt: new Date().toISOString(),
      });
      console.log(`${line} -> harness error: ${e.message}`);
    }
  }

  const tally = { delivered: 0, gated: 0, dead: 0, unreachable: 0 };
  for (const r of results) tally[r.status] += 1;

  writeFileSync(
    new URL("../data/verifications.json", import.meta.url),
    `${JSON.stringify({ updatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );

  console.log("\n=== verification pass ===");
  for (const cat of [...new Set(candidates.map((c) => c.category))]) {
    const rows = results.filter((r) => r.category === cat);
    console.log(`\n${cat}:`);
    for (const r of rows) {
      console.log(`  ${r.status.padEnd(11)} ${r.name} (${r.tokenId}) ${r.responseMs}ms`);
    }
  }
  console.log(
    `\ntally: delivered=${tally.delivered} gated=${tally.gated} dead=${tally.dead} unreachable=${tally.unreachable}` +
      (skipped ? ` skipped=${skipped} (25 minute budget exhausted)` : ""),
  );
  console.log(
    `quality reviews: primary=${llmStats.primary} fallback=${llmStats.fallback} failed=${llmStats.failed}`,
  );
  console.log(`wrote data/verifications.json with ${results.length} results`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
