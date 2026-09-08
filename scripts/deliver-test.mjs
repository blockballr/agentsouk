// Live delivery matrix: hire candidates through the x402 settle path and
// record which agents actually deliver.
//
// Usage (server must be running on :3000):
//   node scripts/deliver-test.mjs
// writes data/delivery-matrix.json; many dead/gated entries are expected data
// unprobed candidates are written as status "skipped" and never counted dead
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const CHAIN_ID = 56;
const AMOUNT_USD = 2;
const BUDGET_MS = 35 * 60 * 1000;
const PER_CATEGORY = 14;
const GENERAL = 8;
const CATEGORIES = ["rebalancing", "grid-trading", "yield", "health-factor"];

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

const candidatesFromList = () => {
  const list = JSON.parse(readFileSync(new URL("../data/agents.json", import.meta.url)));
  const byScore = (a, b) => (b.average_score ?? 0) - (a.average_score ?? 0);
  const pools = {};
  for (const cat of [...CATEGORIES, "general"]) {
    pools[cat] = list.agents
      .filter((a) => a.chain_id === CHAIN_ID && a.category === cat)
      .sort(byScore);
  }
  return pools;
};

async function probeDetail(chainId, tokenId) {
  const res = await fetchJson(`${BASE}/api/agents/${chainId}/${tokenId}`, {}, 45000);
  if (res.status !== 200 || !res.body?.data) return null;
  return res.body.data;
}

// pick candidates per category, keeping only agents whose registry detail
// shows a callable endpoint; stop at the per-category cap or the wall clock
async function selectCandidates() {
  const pools = candidatesFromList();
  const selected = [];
  for (const cat of CATEGORIES) {
    const cap = PER_CATEGORY;
    let have = 0;
    for (const a of pools[cat] ?? []) {
      if (have >= cap || outOfTime()) break;
      const detail = await probeDetail(CHAIN_ID, a.token_id);
      if (!detail) continue;
      if (!detail.mcp_server && !detail.a2a_endpoint) continue;
      selected.push({
        tokenId: a.token_id,
        chainId: CHAIN_ID,
        name: a.name,
        category: cat,
        protocol: detail.mcp_server ? "mcp" : "a2a",
      });
      have += 1;
    }
    console.log(`candidates ${cat}: ${have}`);
  }
  let have = 0;
  for (const a of pools.general ?? []) {
    if (have >= GENERAL || outOfTime()) break;
    const detail = await probeDetail(CHAIN_ID, a.token_id);
    if (!detail) continue;
    if (!detail.mcp_server && !detail.a2a_endpoint) continue;
    selected.push({
      tokenId: a.token_id,
      chainId: CHAIN_ID,
      name: a.name,
      category: "general",
      protocol: detail.mcp_server ? "mcp" : "a2a",
    });
    have += 1;
  }
  console.log(`candidates general: ${have}`);
  return selected;
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

// a settled hire unlocks /api/x402/deliver; ask for capabilities first, then
// attempt one real call
async function deliverJson(paymentId, extra = {}) {
  return fetchJson(
    `${BASE}/api/x402/deliver`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ paymentId, ...extra }),
    },
    90000,
  );
}

const GATED_RE = /gates direct calls behind its own x402/i;

async function classify(cand) {
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
      detail: `deliver not ok: ${JSON.stringify(cap.body).slice(0, 300)}`,
    };
  }

  if (d.protocol === "mcp") {
    const tools = d.tools ?? [];
    if (!tools.length) {
      return { status: "dead", detail: "capabilities ok but tools/list returned no tools" };
    }
    const names = tools.map((t) => t.name);
    const pick = tools.find((t) => !t.schema?.required?.length);
    if (!pick) {
      return {
        status: "delivers",
        detail: "delivers on capabilities probe alone; every tool requires arguments so no zero-arg call was made",
        tools: names,
      };
    }
    const call = await deliverJson(hire.paymentId, { tool: pick.name, args: {} });
    if (call.status === 402 || call.body?.success === false) {
      const err = call.body?.error ?? `HTTP ${call.status}`;
      if (GATED_RE.test(err)) return { status: "gated", detail: err, tools: names };
      return {
        status: "delivers",
        detail: `delivers on capabilities probe (tools: ${names.join(", ")}); tools/call of ${pick.name} failed: ${err}`,
        tools: names,
      };
    }
    const cd = call.body?.data;
    if (!cd?.ok) {
      return {
        status: "delivers",
        detail: `delivers on capabilities probe (tools: ${names.join(", ")}); tools/call of ${pick.name} not ok: ${JSON.stringify(call.body).slice(0, 200)}`,
        tools: names,
      };
    }
    return {
      status: "delivers",
      detail: `tool ${pick.name} -> ${(cd.text ?? "").slice(0, 300)}`,
      tools: names,
    };
  }

  // a2a: the capabilities probe is an empty handshake; send a short task
  const task = "report your status in one sentence";
  const send = await deliverJson(hire.paymentId, { task });
  if (send.status === 402 || send.body?.success === false) {
    const err = send.body?.error ?? `HTTP ${send.status}`;
    if (GATED_RE.test(err)) return { status: "gated", detail: err };
    return { status: "dead", detail: `message/send failed: ${err}` };
  }
  const sd = send.body?.data;
  if (sd?.ok && sd.text) {
    return { status: "delivers", detail: sd.text.slice(0, 300) };
  }
  return {
    status: "dead",
    detail: `a2a send not ok: ${JSON.stringify(send.body).slice(0, 300)}`,
  };
}

async function main() {
  const all = await selectCandidates();
  console.log(`probing ${all.length} candidates, budget left ${Math.round(timeLeft() / 1000)}s`);

  const matrix = [];
  for (const cand of all) {
    if (outOfTime()) {
      matrix.push({
        tokenId: cand.tokenId,
        name: cand.name,
        category: cand.category,
        protocol: cand.protocol,
        status: "skipped",
        detail: "skipped: 35 minute wall clock budget exhausted before probe",
      });
      continue;
    }
    const line = `[${cand.category}] ${cand.name} (${cand.tokenId}, ${cand.protocol})`;
    try {
      const verdict = await classify(cand);
      const entry = {
        tokenId: cand.tokenId,
        name: cand.name,
        category: cand.category,
        protocol: cand.protocol,
        status: verdict.status,
        detail: verdict.detail,
      };
      if (verdict.tools) entry.tools = verdict.tools;
      matrix.push(entry);
      console.log(`${line} -> ${verdict.status}: ${verdict.detail.slice(0, 120)}`);
    } catch (e) {
      matrix.push({
        tokenId: cand.tokenId,
        name: cand.name,
        category: cand.category,
        protocol: cand.protocol,
        status: "dead",
        detail: `harness error: ${e.message}`,
      });
      console.log(`${line} -> harness error: ${e.message}`);
    }
  }

  const tally = { delivers: 0, gated: 0, dead: 0 };
  let skipped = 0;
  for (const m of matrix) {
    if (m.status === "skipped") skipped += 1;
    else tally[m.status] += 1;
  }

  const out = {
    capturedAt: new Date().toISOString(),
    source: "live-registry",
    candidates: matrix,
  };
  writeFileSync(
    new URL("../data/delivery-matrix.json", import.meta.url),
    `${JSON.stringify(out, null, 2)}\n`,
  );

  console.log("\n=== delivery matrix ===");
  for (const cat of [...CATEGORIES, "general"]) {
    const rows = matrix.filter((m) => m.category === cat);
    console.log(`\n${cat}:`);
    for (const r of rows) {
      console.log(`  ${r.status.padEnd(8)} ${r.name} (${r.tokenId}) [${r.protocol}] ${r.detail.slice(0, 100)}`);
    }
  }
  console.log(`\ntally: delivers=${tally.delivers} gated=${tally.gated} dead=${tally.dead} skipped=${skipped} (skipped excluded from tally)`);
  console.log(`wrote data/delivery-matrix.json with ${matrix.length} candidates`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
