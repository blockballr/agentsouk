// Read-only load test for the live Agent Souk deployment.
// Uses only Node's built-in fetch. Runs a concurrency ramp and records per-endpoint
// success/failure and latency percentiles. Never touches write or paid routes.
//
// Usage:
//   node scripts/load-test.mjs
//   node scripts/load-test.mjs --site=https://agentsouk.xyz --client=0x... --levels=5:6000,25:8000
//
// Defaults are deliberately small: this is the owner's site, not a target we own.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const args = new Map(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i === -1 ? [a.replace(/^--/, ""), "1"] : [a.slice(2, i), a.slice(i + 1)];
  }),
);

const OUT_FILE = args.get("out") ?? join(HERE, "load-test-results.json");

const SITE = (args.get("site") ?? "https://agentsouk.xyz").replace(/\/$/, "");
const API_BASE = (args.get("api") ?? `${SITE}/api`).replace(/\/$/, "");
// Public owner/buyer wallet used by the project; no secret material.
const CLIENT = args.get("client") ?? "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713";

const USER_AGENT =
  "AgentSouk-LoadTest/1.0 (+https://agentsouk.xyz; owner-approved read-only probe)";
const REQUEST_TIMEOUT_MS = 20000;
const THINK_MIN_MS = 300;
const THINK_MAX_MS = 800;
const MAX_REQUESTS = Number(args.get("maxRequests") ?? 8000);
// Stop the ramp when a whole level looks unhealthy.
const MAX_ERROR_RATE = 0.1;
const MAX_P95_MS = 5000;

// concurrency:windowMs. Warm up first, then step up while the tree stays green.
const DEFAULT_LEVELS = "5:6000,25:8000,100:8000,250:8000";
const LEVELS = (args.get("levels") ?? DEFAULT_LEVELS).split(",").map((s) => {
  const [c, ms] = s.split(":");
  return { concurrency: Number(c), windowMs: Number(ms) };
});

// Rough mix of what a browsing visitor fetches. The agents list is the hot read;
// sessions is the ongoing page; hires is a rarer wallet-scoped lookup.
const MIX = [
  { name: "doc", weight: 1 },
  { name: "asset", weight: 1 },
  { name: "agents", weight: 4 },
  { name: "sessions", weight: 3 },
  { name: "hires", weight: 1 },
];
// --only=<name> isolates a single endpoint so a slow tier can be attributed.
const ONLY = args.get("only");
const ACTIVE_MIX = ONLY ? MIX.filter((m) => m.name === ONLY) : MIX;
if (ACTIVE_MIX.length === 0) {
  throw new Error(`--only=${ONLY} matched no endpoint; try one of ${MIX.map((m) => m.name).join(", ")}`);
}
const TOTAL_WEIGHT = ACTIVE_MIX.reduce((s, m) => s + m.weight, 0);

function log(...parts) {
  console.log(...parts);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

function stats(samples) {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
    max: Math.round(sorted[sorted.length - 1]),
    avg: Math.round(sum / sorted.length),
  };
}

// Discover the hashed SPA asset from the document so a redeploy does not stale the test.
async function discoverAsset() {
  try {
    const res = await fetch(`${SITE}/`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const html = await res.text();
    const match = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
    if (match) return match[0];
  } catch {
    // fall through to the last known asset
  }
  return "/assets/index-UjstZ34l.js";
}

function buildEndpoints(asset) {
  return {
    doc: { url: `${SITE}/`, label: "GET /" },
    asset: { url: `${SITE}${asset}`, label: `GET ${asset}` },
    agents: { url: `${API_BASE}/agents?limit=24`, label: "GET /api/agents?limit=24" },
    sessions: {
      url: `${API_BASE}/sessions?client=${encodeURIComponent(CLIENT)}`,
      label: "GET /api/sessions?client=...",
    },
    hires: {
      url: `${API_BASE}/hires/by-wallet?wallet=${encodeURIComponent(CLIENT)}`,
      label: "GET /api/hires/by-wallet?wallet=...",
    },
  };
}

function pickEndpoint() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const m of ACTIVE_MIX) {
    r -= m.weight;
    if (r <= 0) return m.name;
  }
  return ACTIVE_MIX[ACTIVE_MIX.length - 1].name;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let globalRequests = 0;

async function worker(endpoints, level, windowMs, bucket) {
  const started = Date.now();
  while (Date.now() - started < windowMs && globalRequests < MAX_REQUESTS) {
    const name = pickEndpoint();
    const ep = endpoints[name];
    const t0 = performance.now();
    let status = 0;
    let ok = false;
    let error = null;
    try {
      const res = await fetch(ep.url, {
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = res.status;
      ok = res.ok;
      // Drain the body so latency reflects the full response and sockets are reused.
      await res.arrayBuffer();
    } catch (e) {
      const isTimeout = e && (e.name === "TimeoutError" || e.name === "AbortError");
      status = isTimeout ? "TIMEOUT" : "NETWORK";
      // undici hides the real socket error behind cause; keep it so a burst is diagnosable.
      const cause = e && e.cause ? e.cause : null;
      const code = (cause && (cause.code || cause.message)) || (e && e.code) || null;
      error = [e && e.message ? e.message : String(e), code].filter(Boolean).join(": ");
      bucket.networkCauses[code || "unknown"] = (bucket.networkCauses[code || "unknown"] ?? 0) + 1;
    }
    const ms = performance.now() - t0;
    globalRequests += 1;

    const target = bucket.endpoints[name];
    target.requests += 1;
    if (ok) {
      target.successes += 1;
    } else {
      target.failures += 1;
      const key = String(status);
      target.failuresByStatus[key] = (target.failuresByStatus[key] ?? 0) + 1;
      if (target.sampleErrors.length < 3) {
        target.sampleErrors.push({ status: key, error, at: new Date().toISOString() });
      }
    }
    target.latencies.push(ms);
    bucket.allLatencies.push(ms);
    bucket.statusCounts[String(status)] = (bucket.statusCounts[String(status)] ?? 0) + 1;

    await sleep(THINK_MIN_MS + Math.random() * (THINK_MAX_MS - THINK_MIN_MS));
  }
}

function emptyLevel(concurrency, windowMs) {
  const endpoints = {};
  for (const m of ACTIVE_MIX) {
    endpoints[m.name] = {
      requests: 0,
      successes: 0,
      failures: 0,
      failuresByStatus: {},
      latencies: [],
      sampleErrors: [],
    };
  }
  return {
    concurrency,
    windowMs,
    endpoints,
    allLatencies: [],
    statusCounts: {},
    networkCauses: {},
  };
}

function summarizeLevel(bucket, startedAt, endedAt) {
  const elapsedSec = Math.max(0.001, (endedAt - startedAt) / 1000);
  const requests = bucket.allLatencies.length;
  const successes = Object.values(bucket.endpoints).reduce((s, e) => s + e.successes, 0);
  const overall = stats(bucket.allLatencies);
  const endpoints = {};
  for (const [name, e] of Object.entries(bucket.endpoints)) {
    endpoints[name] = {
      requests: e.requests,
      successes: e.successes,
      failures: e.failures,
      successRate: e.requests ? Number((e.successes / e.requests).toFixed(4)) : null,
      failuresByStatus: e.failuresByStatus,
      ...stats(e.latencies),
      sampleErrors: e.sampleErrors,
    };
  }
  return {
    concurrency: bucket.concurrency,
    windowMs: bucket.windowMs,
    requests,
    successes,
    failures: requests - successes,
    errorRate: requests ? Number(((requests - successes) / requests).toFixed(4)) : 0,
    throughputRps: Number((requests / elapsedSec).toFixed(2)),
    p50: overall.p50,
    p95: overall.p95,
    p99: overall.p99,
    max: overall.max,
    statusCounts: bucket.statusCounts,
    networkCauses: bucket.networkCauses,
    endpoints,
  };
}

async function main() {
  log("Agent Souk load test (read-only)");
  log("  site :", SITE);
  log("  api  :", API_BASE);
  log("  client:", CLIENT);
  log("  levels:", LEVELS.map((l) => `${l.concurrency}@${l.windowMs}ms`).join(", "));
  log("");

  const asset = await discoverAsset();
  const endpoints = buildEndpoints(asset);
  log("  asset:", asset);
  log("");

  const run = {
    generatedAt: new Date().toISOString(),
    target: { site: SITE, api: API_BASE, client: CLIENT, asset },
    config: {
      levels: LEVELS,
      mix: ACTIVE_MIX,
      thinkTimeMs: [THINK_MIN_MS, THINK_MAX_MS],
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      maxRequests: MAX_REQUESTS,
      thresholds: { maxErrorRate: MAX_ERROR_RATE, maxP95Ms: MAX_P95_MS },
    },
    levels: [],
    summary: {},
  };

  let stopReason = null;
  let firstBreach = null;

  for (const level of LEVELS) {
    const bucket = emptyLevel(level.concurrency, level.windowMs);
    log(`> level concurrency=${level.concurrency} for ${level.windowMs}ms`);
    const startedAt = Date.now();
    await Promise.all(
      Array.from({ length: level.concurrency }, () =>
        worker(endpoints, level, level.windowMs, bucket),
      ),
    );
    const endedAt = Date.now();
    const summary = summarizeLevel(bucket, startedAt, endedAt);
    run.levels.push(summary);

    log(
      `  requests=${summary.requests} ok=${summary.successes} err=${summary.failures}` +
        ` (${(summary.errorRate * 100).toFixed(1)}%)` +
        ` p50=${summary.p50}ms p95=${summary.p95}ms p99=${summary.p99}ms` +
        ` rps=${summary.throughputRps}`,
    );
    for (const [name, e] of Object.entries(summary.endpoints)) {
      if (e.requests === 0) continue;
      log(
        `    ${name.padEnd(8)} n=${String(e.requests).padEnd(5)} ok=${
          e.successRate === null ? "-" : (e.successRate * 100).toFixed(1) + "%"
        } p50=${e.p50}ms p95=${e.p95}ms p99=${e.p99}ms`,
      );
    }
    if (summary.failures > 0) {
      log(`    network causes: ${JSON.stringify(summary.networkCauses)}`);
    }

    // Evaluate the gate on this completed level only.
    const breachedError = summary.errorRate > MAX_ERROR_RATE;
    const breachedLatency = summary.p95 > MAX_P95_MS;
    if (breachedError || breachedLatency) {
      if (!firstBreach) {
        firstBreach = {
          concurrency: level.concurrency,
          errorRate: summary.errorRate,
          p95: summary.p95,
          breachedError,
          breachedLatency,
        };
      }
      const why = [
        breachedError ? `error rate ${(summary.errorRate * 100).toFixed(1)}% > 10%` : null,
        breachedLatency ? `p95 ${summary.p95}ms > 5000ms` : null,
      ]
        .filter(Boolean)
        .join(" and ");
      stopReason = `stopped after concurrency=${level.concurrency}: ${why}`;
      log(`  STOP: ${stopReason}`);
      break;
    }
    log("");
  }

  const allRequests = run.levels.reduce((s, l) => s + l.requests, 0);
  const allSuccesses = run.levels.reduce((s, l) => s + l.successes, 0);
  run.summary = {
    levelsRun: run.levels.length,
    stoppedEarly: Boolean(stopReason),
    stopReason,
    firstBreach,
    totalRequests: allRequests,
    totalSuccesses: allSuccesses,
    totalFailures: allRequests - allSuccesses,
    overallSuccessRate: allRequests ? Number((allSuccesses / allRequests).toFixed(4)) : null,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(run, null, 2) + "\n", "utf8");

  log("");
  log("summary:", JSON.stringify(run.summary));
  log("wrote", OUT_FILE);
}

main().catch((e) => {
  console.error("load test failed:", e);
  process.exitCode = 1;
});
