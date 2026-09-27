// Fan-out driver for the temporary Cloudflare load Worker.
// One invocation is capped on the Free plan (50 subrequests, about 6 concurrent
// sockets), so the driver sends several invocations in parallel and aggregates.
// Each invocation is a separate public request, so each gets its own isolate and
// its own outbound sockets, which is what makes the aggregate concurrency real.
//
// Usage: WORKER_URL=https://name.sub.workers.dev node scripts/cloud-load/run.mjs

import https from "node:https";

const WORKER_URL = (process.env.WORKER_URL || "https://agentsouk-loadtest.blockballr.workers.dev").replace(/\/$/, "");
const RUNGS = (process.env.RUNGS || "25,50,100,250").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
const PER_INVOCATION = Number(process.env.CONCURRENCY_PER_INVOCATION || 6);
const DURATION_MS = Number(process.env.DURATION_MS || 2000);
const THINK_MS = Number(process.env.THINK_MS || 120);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 10000);
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS || 40);
const WARMUP = Number(process.env.WARMUP || 1);
const RETRIES = Number(process.env.RETRIES || 2);
const CLI_TIMEOUT_MS = Number(process.env.CLI_TIMEOUT_MS || 30000);

const WALLET = "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713";
const ENDPOINTS = [
  { name: "catalogue", url: "https://api.agentsouk.xyz/api/agents?limit=24&sort=score" },
  { name: "detail", url: "https://api.agentsouk.xyz/api/agents/97/2019" },
  { name: "stats", url: "https://api.agentsouk.xyz/api/stats" },
  { name: "sessions", url: `https://api.agentsouk.xyz/api/sessions?client=${WALLET}` },
];

// node:https with a high socket cap avoids the undici connection pool, which was
// the actual ceiling around 40 parallel invocations from this machine.
const agent = new https.Agent({ keepAlive: true, maxSockets: 160, maxFreeSockets: 80 });

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`worker ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("worker returned invalid JSON"));
        }
      });
    });
    req.setTimeout(CLI_TIMEOUT_MS, () => req.destroy(new Error("worker request timed out")));
    req.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunksFor(rung) {
  const chunks = [];
  let left = rung;
  while (left > 0) {
    chunks.push(Math.min(PER_INVOCATION, left));
    left -= PER_INVOCATION;
  }
  return chunks;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

async function invoke(target, concurrency) {
  const qs = new URLSearchParams({
    target,
    concurrency: String(concurrency),
    durationMs: String(DURATION_MS),
    thinkMs: String(THINK_MS),
    timeoutMs: String(TIMEOUT_MS),
    maxRequests: String(MAX_REQUESTS),
    warmup: String(WARMUP),
  });
  try {
    const body = await getJson(`${WORKER_URL}/?${qs}`);
    return { ok: true, body };
  } catch (err) {
    const cause = err && err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : "";
    return { ok: false, error: String((err && err.message) || err) + cause };
  }
}

async function invokeWithRetry(target, concurrency) {
  let last = null;
  for (let i = 0; i <= RETRIES; i += 1) {
    last = await invoke(target, concurrency);
    if (last.ok) return last;
    if (i < RETRIES) await sleep(300 * (i + 1));
  }
  return last;
}

function aggregate(meta, results, wallMs) {
  const latencies = [];
  const statusCounts = {};
  const invocationFailures = [];
  let total = 0;
  let successes = 0;
  let errors = 0;
  let invocationsOk = 0;
  let limitHit = false;

  for (const r of results) {
    if (!r.ok) {
      invocationFailures.push(r.error);
      continue;
    }
    invocationsOk += 1;
    total += r.body.totalRequests || 0;
    successes += r.body.successes || 0;
    errors += r.body.errors || 0;
    limitHit = limitHit || Boolean(r.body.subrequestLimitHit);
    for (const [code, count] of Object.entries(r.body.statusCounts || {})) {
      statusCounts[code] = (statusCounts[code] || 0) + count;
    }
    if (Array.isArray(r.body.latenciesMs)) latencies.push(...r.body.latenciesMs);
  }

  latencies.sort((a, b) => a - b);
  const failuresByStatus = {};
  for (const [code, count] of Object.entries(statusCounts)) {
    const n = Number(code);
    if (n < 200 || n >= 300) failuresByStatus[code] = count;
  }

  return {
    endpoint: meta.name,
    target: meta.target,
    requestedConcurrency: meta.requestedConcurrency,
    effectiveConcurrency: meta.effectiveConcurrency,
    invocations: results.length,
    invocationsOk,
    invocationFailures,
    wallMs,
    totalRequests: total,
    successes,
    failuresByStatus,
    statusCounts,
    errorCount: errors,
    successRate: total ? Number((successes / total).toFixed(4)) : null,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      min: latencies[0] ?? null,
      max: latencies[latencies.length - 1] ?? null,
    },
    rps: wallMs > 0 ? Number((total / (wallMs / 1000)).toFixed(2)) : null,
    subrequestLimitHit: limitHit,
  };
}

async function runRung(rung, endpoint) {
  const chunks = chunksFor(rung);
  const started = Date.now();
  const results = await Promise.all(chunks.map((c) => invokeWithRetry(endpoint.url, c)));
  const wallMs = Date.now() - started;
  return aggregate(
    { name: endpoint.name, target: endpoint.url, requestedConcurrency: rung, effectiveConcurrency: rung },
    results,
    wallMs,
  );
}

// Open the driver's sockets before the measured rungs, otherwise the first rung
// that needs many new TLS connections spends seconds handshaking and the window
// is no longer concurrent.
async function preflight(sockets) {
  const qs = new URLSearchParams({
    target: ENDPOINTS[2].url,
    concurrency: "1",
    durationMs: "400",
    thinkMs: "0",
    timeoutMs: "5000",
    maxRequests: "2",
    warmup: "0",
  });
  await Promise.all(Array.from({ length: sockets }, () => getJson(`${WORKER_URL}/?${qs}`).catch(() => null)));
}

async function main() {
  const maxChunks = Math.ceil(Math.max(...RUNGS) / PER_INVOCATION);
  await preflight(maxChunks);
  process.stderr.write(`preflight warmed ${maxChunks} sockets\n`);

  const rows = [];
  for (const rung of RUNGS) {
    for (const endpoint of ENDPOINTS) {
      const row = await runRung(rung, endpoint);
      rows.push(row);
      process.stderr.write(
        `rung=${rung} endpoint=${row.endpoint} ok=${row.invocationsOk}/${row.invocations} ` +
          `req=${row.totalRequests} success=${row.successRate} p50=${row.latencyMs.p50} ` +
          `p95=${row.latencyMs.p95} p99=${row.latencyMs.p99} wall=${row.wallMs}\n`,
      );
    }
  }
  process.stdout.write(
    JSON.stringify(
      { workerUrl: WORKER_URL, rungs: RUNGS, perInvocation: PER_INVOCATION, durationMs: DURATION_MS, thinkMs: THINK_MS, maxRequests: MAX_REQUESTS, rows },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  process.stderr.write(`driver failed: ${String((err && err.stack) || err)}\n`);
  process.exit(1);
});
