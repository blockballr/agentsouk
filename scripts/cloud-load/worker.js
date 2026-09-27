// Temporary Cloudflare Worker: a bounded, read-only load runner for Agent Souk.
// Deployed as agentsouk-loadtest only for a cloud-sourced test and removed after.
// Each invocation issues GETs for a short window and returns a JSON summary.
//
// Free plan facts this file is built around: 50 subrequests per invocation and
// about 6 truly concurrent sockets per invocation. One invocation therefore
// cannot reach high concurrency, so the driver (run.mjs) sends several
// invocations in parallel and aggregates. mode=probe measures the subrequest cap.

const MAX_CONCURRENCY = 64;
const MAX_DURATION_MS = 20000;
const MAX_REQUESTS_CAP = 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function num(sp, key, fallback) {
  const raw = sp.get(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function runLoad(sp) {
  const target = sp.get("target");
  if (!target || !/^https:\/\//.test(target)) {
    return json({ error: "target must be an absolute https URL" }, 400);
  }
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(num(sp, "concurrency", 6))));
  const durationMs = Math.max(500, Math.min(MAX_DURATION_MS, Math.floor(num(sp, "durationMs", 2000))));
  const thinkMs = Math.max(0, Math.min(5000, Math.floor(num(sp, "thinkMs", 0))));
  const timeoutMs = Math.max(500, Math.min(60000, Math.floor(num(sp, "timeoutMs", 10000))));
  const maxRequests = Math.max(1, Math.min(MAX_REQUESTS_CAP, Math.floor(num(sp, "maxRequests", 40))));
  const warmup = Math.max(0, Math.min(10, Math.floor(num(sp, "warmup", 1))));

  const deadline = Date.now() + durationMs;
  const latencies = [];
  const statusCounts = {};
  let reserved = 0;
  let total = 0;
  let successes = 0;
  let errors = 0;
  let warmupSeen = 0;
  let subrequestLimitHit = false;

  const reserve = () => (reserved < maxRequests ? ((reserved += 1), true) : false);

  async function slot() {
    while (Date.now() < deadline) {
      if (!reserve()) return;
      const started = Date.now();
      let status = 0;
      try {
        const res = await fetch(target, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "user-agent": "agentsouk-cloud-loadtest/1.0" },
        });
        status = res.status;
        if (res.body) {
          try {
            await res.body.cancel();
          } catch {
            // body already consumed or connection gone
          }
        }
      } catch (err) {
        const text = String((err && err.message) || err);
        if (/subrequest/i.test(text)) subrequestLimitHit = true;
        status = -1;
      }
      const ms = Date.now() - started;
      if (warmupSeen < warmup) {
        warmupSeen += 1;
        continue;
      }
      total += 1;
      if (status < 0) {
        errors += 1;
      } else {
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        if (status >= 200 && status < 300) successes += 1;
        latencies.push(ms);
      }
      if (thinkMs > 0 && Date.now() < deadline) await sleep(thinkMs);
    }
  }

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => slot()));
  const wallMs = Date.now() - startedAt;
  latencies.sort((a, b) => a - b);

  const failuresByStatus = {};
  for (const [code, count] of Object.entries(statusCounts)) {
    const n = Number(code);
    if (n < 200 || n >= 300) failuresByStatus[code] = count;
  }

  return json({
    target,
    concurrency,
    durationMs,
    thinkMs,
    timeoutMs,
    maxRequests,
    wallMs,
    totalRequests: total,
    successes,
    failures: total - successes,
    errors,
    failuresByStatus,
    statusCounts,
    latencyMs: {
      p50: pct(latencies, 50),
      p95: pct(latencies, 95),
      p99: pct(latencies, 99),
      min: latencies[0] ?? null,
      max: latencies[latencies.length - 1] ?? null,
    },
    subrequestsUsed: reserved,
    subrequestLimitHit,
    latenciesMs: latencies,
    ranAt: new Date().toISOString(),
  });
}

// Probe mode fires `requested` subrequests at once and counts how many succeed,
// which reveals the per-invocation subrequest limit without touching the site.
async function runProbe(sp) {
  const probeUrl = sp.get("probeUrl") || "https://cloudflare.com/cdn-cgi/trace";
  const requested = Math.max(1, Math.min(2000, Math.floor(num(sp, "requested", 1200))));
  const timeoutMs = Math.max(500, Math.min(60000, Math.floor(num(sp, "timeoutMs", 15000))));
  const started = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: requested }, () =>
      Promise.resolve()
        .then(() =>
          fetch(probeUrl, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: { "user-agent": "agentsouk-loadtest-probe/1.0" },
          }),
        )
        .then(async (res) => {
          if (res.body) {
            try {
              await res.body.cancel();
            } catch {
              // body already consumed
            }
          }
          return res.status;
        }),
    ),
  );
  let succeeded = 0;
  let subrequestLimitErrors = 0;
  let otherErrors = 0;
  for (const r of results) {
    if (r.status === "fulfilled") succeeded += 1;
    else if (/subrequest/i.test(String((r.reason && r.reason.message) || r.reason))) subrequestLimitErrors += 1;
    else otherErrors += 1;
  }
  return json({
    mode: "probe",
    probeUrl,
    requested,
    succeeded,
    subrequestLimitErrors,
    otherErrors,
    wallMs: Date.now() - started,
  });
}

export default {
  async fetch(request) {
    const sp = new URL(request.url).searchParams;
    try {
      if (sp.get("probe") === "1") return await runProbe(sp);
      return await runLoad(sp);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
  },
};
