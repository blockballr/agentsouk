// Performance-data spike: find agents that SELF-REPORT performance figures.
// Absolute rule: no estimation, derivation, or invention — the verbatim
// sentence is the data. Run steps independently:
//
//   node scripts/performance-scan.mjs          # step 1: registration-text scan
//   node scripts/performance-scan.mjs --probe  # steps 1+2: also probe delivered agents (needs :3000)
//
// writes data/performance.json
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PROBE = process.argv.includes("--probe");
const BASE = "http://localhost:3000";
const BUDGET_MS = 10 * 60 * 1000;
const TOOLS_RE = /report|pnl|performance|stats|metrics/i;

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

// --- step 1: registration-text scan -----------------------------------------
// signals tuned for precision over recall (see .superpowers/performance-brief.md)
const PNL_RES = [
  /pnl[^.]{0,40}[+-]?\d+(\.\d+)?%/i,
  /\d+(\.\d+)?%\s*pnl/i,
  /30d\s*pnl/i,
];
const IL_FEES_RES = [
  /(impermanent|divergence)\s+loss/i,
  /fees\s+earned[^.]{0,30}\$?\d+/i,
];
const WIN_RATE_RE = /win\s*rate[^.]{0,30}\d+(\.\d+)?%?/i;
const APY_RE = /(\d+(\.\d+)?)\s*%\s*(apy|roi)/i;
const TIMEFRAME_RE = /30\s*d|7\s*d|24\s*h/i;

// split into sentences on .!? boundaries (keep trailing punctuation)
function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasNumber(s) {
  return /\d/.test(s);
}

function classifySentence(s) {
  const kinds = [];
  if (PNL_RES.some((re) => re.test(s))) kinds.push("pnl");
  if (WIN_RATE_RE.test(s)) kinds.push("win-rate");
  if (IL_FEES_RES[1].test(s)) kinds.push("fees");
  if (IL_FEES_RES[0].test(s) && hasNumber(s)) kinds.push("il");
  const apy = APY_RE.exec(s);
  if (apy) {
    // timeframe must appear within 60 chars of the apy/roi match
    const from = Math.max(0, apy.index - 60);
    const window = s.slice(from, apy.index + apy[0].length + 60);
    if (TIMEFRAME_RE.test(window)) kinds.push("apy-roi");
  }
  return kinds;
}

function scanRegistrations() {
  const { agents } = JSON.parse(readFileSync(new URL("../data/agents.json", import.meta.url)));
  const found = [];
  let sentenceHits = 0;
  for (const a of agents) {
    const text = a.description ?? "";
    if (!text) continue;
    const claims = [];
    for (const s of sentences(text)) {
      const kinds = classifySentence(s);
      if (!kinds.length) continue;
      claims.push({ text: s, kind: kinds.join("+") });
      sentenceHits += 1;
    }
    if (claims.length) {
      found.push({
        tokenId: String(a.token_id),
        name: a.name,
        category: a.category ?? null,
        claims,
      });
    }
  }
  return { scanned: agents.length, found, sentenceHits };
}

// --- step 2: live probe of verified-delivered agents -------------------------
const wallet = privateKeyToAccount(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);

async function settleHire(agent) {
  const reqRes = await fetchJson(`${BASE}/api/x402/requirements`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      chainId: agent.chain_id,
      tokenId: agent.token_id,
      amountUsd: 2,
      client: wallet.address,
    }),
  });
  const pr = reqRes.body?.data?.paymentRequirements;
  if (reqRes.status !== 200 || !pr) {
    return { ok: false, detail: `requirements failed (HTTP ${reqRes.status})` };
  }
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const message = {
    from: wallet.address,
    to: getAddress(pr.payTo),
    value: BigInt(pr.amount),
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + 300),
    nonce,
  };
  const signature = await wallet.signTypedData({
    domain: {
      name: pr.extra.name,
      version: pr.extra.version,
      chainId: BigInt(agent.chain_id),
      verifyingContract: getAddress(pr.asset),
    },
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
    url: `/agents/${agent.chain_id}/${agent.token_id}`,
    description: `Hire ${agent.name} for a paid session`,
    mimeType: "application/json",
  };
  const settleRes = await fetchJson(`${BASE}/api/x402/settle`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
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
        chainId: agent.chain_id,
        tokenId: agent.token_id,
        name: agent.name,
        symbol: "USDC",
      },
    }),
  });
  if (!(settleRes.status === 200 && settleRes.body?.success)) {
    return { ok: false, detail: `settle failed (HTTP ${settleRes.status})` };
  }
  return { ok: true, paymentId: settleRes.body.paymentId };
}

async function deliverJson(paymentId, extra = {}) {
  return fetchJson(
    `${BASE}/api/x402/deliver`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ paymentId, ...extra }) },
    90000,
  );
}

async function probeAgent(entry) {
  const tokenId = String(entry.token_id);
  const settle = await settleHire(entry);
  if (!settle.ok) return { tokenId, status: "settle-failed", detail: settle.detail };
  const cap = await deliverJson(settle.paymentId);
  if (cap.status === 402 || cap.body?.success === false || !cap.body?.data?.ok) {
    return { tokenId, status: "deliver-failed", detail: JSON.stringify(cap.body).slice(0, 300) };
  }
  const d = cap.body.data;
  if (d.protocol !== "mcp") {
    return { tokenId, status: "no-mcp", detail: `protocol ${d.protocol}; not probed per brief` };
  }
  const tools = d.tools ?? [];
  const targets = tools.filter((t) => TOOLS_RE.test(t.name));
  if (!targets.length) {
    return {
      tokenId,
      status: "no-matching-tool",
      detail: `tools: ${tools.map((t) => t.name).join(", ") || "(none)"}`,
    };
  }
  const calls = [];
  for (const t of targets) {
    const call = await deliverJson(settle.paymentId, { tool: t.name, args: {} });
    const cd = call.body?.data;
    const raw = cd?.ok ? (cd.text ?? "") : `error: ${cd?.error ?? call.body?.error ?? `HTTP ${call.status}`}`;
    calls.push({ tool: t.name, rawOutput: String(raw) });
  }
  return { tokenId, status: "probed", tool: calls[0].tool, rawOutput: calls[0].rawOutput, calls };
}

async function probeDelivered() {
  const ver = JSON.parse(readFileSync(new URL("../data/verifications.json", import.meta.url)));
  const delivered = (ver.results ?? []).filter((r) => r.status === "delivered");
  const { agents } = JSON.parse(readFileSync(new URL("../data/agents.json", import.meta.url)));
  const byToken = new Map(agents.map((a) => [String(a.token_id), a]));

  const startedAt = Date.now();
  const probeResults = [];
  for (const r of delivered) {
    if (Date.now() - startedAt > BUDGET_MS) {
      probeResults.push({ tokenId: r.tokenId, status: "skipped", detail: "10 minute probe budget exhausted" });
      continue;
    }
    const agent = byToken.get(String(r.tokenId));
    if (!agent) {
      probeResults.push({ tokenId: r.tokenId, status: "skipped", detail: "not in agents.json snapshot" });
      continue;
    }
    try {
      const res = await probeAgent(agent);
      probeResults.push(res);
      console.log(`probe ${r.name} (${r.tokenId}) -> ${res.status}`);
    } catch (e) {
      probeResults.push({ tokenId: r.tokenId, status: "error", detail: e.message });
      console.log(`probe ${r.name} (${r.tokenId}) -> error: ${e.message}`);
    }
  }
  return probeResults;
}

// --- main ---------------------------------------------------------------------
function mergeProbeResults(existing, fresh) {
  const byToken = new Map((existing.probeResults ?? []).map((p) => [p.tokenId, p]));
  for (const p of fresh) byToken.set(p.tokenId, p);
  return [...byToken.values()];
}

async function main() {
  const { scanned, found, sentenceHits } = scanRegistrations();
  console.log(`scanned ${scanned} registrations: ${found.length} agents expose self-reported performance claims (${sentenceHits} verbatim sentences)`);

  const outPath = new URL("../data/performance.json", import.meta.url);
  const existing = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, "utf8"))
    : {};

  const out = {
    scannedAt: new Date().toISOString(),
    scanned,
    agents: found,
  };

  if (PROBE) {
    const fresh = await probeDelivered();
    out.probeResults = mergeProbeResults(existing, fresh);
    const probed = out.probeResults.filter((p) => p.status === "probed");
    console.log(`probe: ${probed.length} agents returned raw tool output`);
  } else if (existing.probeResults) {
    out.probeResults = existing.probeResults;
  }

  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote data/performance.json: ${out.agents.length} agents with claims, ${(out.probeResults ?? []).length} probe results`);
  console.log(`agents exposing anything: ${new Set([...out.agents.map((a) => a.tokenId), ...(out.probeResults ?? []).filter((p) => p.status === "probed" && p.rawOutput).map((p) => p.tokenId)]).size}`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
