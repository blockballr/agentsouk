# Cloud-sourced load test, Agent Souk read paths

Run date: 2026-09-27. Target: live `https://api.agentsouk.xyz` (Next.js on Vercel).
Runner: a temporary Cloudflare Worker `agentsouk-loadtest` at
`https://agentsouk-loadtest.blockballr.workers.dev`, deleted after the run.
Purpose: repeat the earlier local load test from Cloudflare's network so the
local machine's ~100-connection NAT ceiling is out of the measurement.

## How it was run

- `scripts/cloud-load/worker.js` is the runner. One invocation issues concurrent
  GETs to one target URL for a bounded window and returns a JSON summary
  (target, concurrency, duration, total, successes, failures by status, p50/p95/p99).
  `?probe=1` measures the platform subrequest limit. Every invocation is bounded
  by a deadline and a per-request abort, so it always returns.
- `scripts/cloud-load/run.mjs` is the caller-side driver. It fans out several
  parallel invocations, one per concurrency chunk, and aggregates their raw
  latency arrays into the whole-run percentiles.
- `scripts/cloud-load/wrangler.toml` deploys it under the temporary name.

Commands used:

```
npx wrangler deploy --config scripts/cloud-load/wrangler.toml
curl.exe 'https://agentsouk-loadtest.blockballr.workers.dev/?probe=1&requested=1200&timeoutMs=20000'
$env:WORKER_URL='https://agentsouk-loadtest.blockballr.workers.dev'; node scripts/cloud-load/run.mjs
npx wrangler delete --config scripts/cloud-load/wrangler.toml --force
```

Parameters: per-invocation concurrency 6, window 2000 ms, think time 120 ms,
40 subrequests per invocation, 1 discarded warmup request, four endpoints, rungs
25/50/100/250 effective. A preflight opens all driver sockets before the first
measured rung so TLS handshakes do not eat the window. Total measured requests in
the table below: about 9,000, all 2xx.

## Platform limits discovered (and the workaround)

- Subrequest limit: 50, so this account is on Workers Free. A probe of 60
  concurrent subrequests succeeded 50 times and threw "too many subrequests" 10
  times; a probe of 1200 succeeded 50 times and threw 1150 times. There was no
  path around the 50 by asking one invocation for more.
- Per-invocation concurrency: about 6 real sockets, not the requested number.
  Against `detail` (p50 ~160 ms) a single invocation of 48 requests took 1707 ms
  at concurrency 6, 1483 ms at 12, and 1350 ms at 24, while p50 latency rose
  162/329/656 ms. Four times the slots bought 27 percent more throughput and four
  times the latency, which is a hard in-flight cap, not scaling.
- Workaround actually used: caller-side fan-out. The driver sends
  ceil(rung / 6) separate public invocations in parallel, each a separate isolate
  with its own outbound sockets, and aggregates. 250 effective is 42 invocations.
  The driver uses `node:https` with `maxSockets: 160`, not `fetch`, because
  Node's undici pool was itself capping near 40 parallel invocations ("fetch
  failed"), which is the same kind of local artifact the original test hit.
- Rejected approach: in-worker fan-out over a service binding to itself. That was
  built and measured, and it does not create concurrency: a service-bound call
  runs in the same isolate, so from 6 to 48 effective it raised total requests
  only 48 to 113 and pushed p50 from 166 ms to 1346 ms. A plain fetch to its own
  `workers.dev` hostname is also refused with error 1042. Caller-side fan-out is
  the approach that works.

## Raw results, main run

Success rate is 2xx / total. No non-2xx status and no network error was returned
by the site in any rung; the only failures seen anywhere were driver-side socket
exhaustion before the retry/preflight fix, never server errors.

| rung | endpoint | invocations | requests | success | p50 ms | p95 ms | p99 ms | wall ms | rps |
|------|----------|-------------|----------|---------|--------|--------|--------|---------|-----|
| 25 | agents (catalogue) | 5 | 133 | 100% | 234 | 688 | 811 | 2350 | 56.6 |
| 25 | agents/97/2019 (detail) | 5 | 163 | 100% | 163 | 248 | 716 | 2271 | 71.8 |
| 25 | stats | 5 | 163 | 100% | 150 | 184 | 263 | 2183 | 74.7 |
| 25 | sessions?client=wallet | 5 | 152 | 100% | 190 | 374 | 405 | 2381 | 63.8 |
| 50 | agents (catalogue) | 9 | 289 | 100% | 232 | 517 | 805 | 2385 | 121.2 |
| 50 | agents/97/2019 (detail) | 9 | 326 | 100% | 162 | 237 | 464 | 2263 | 144.1 |
| 50 | stats | 9 | 327 | 100% | 147 | 181 | 208 | 2173 | 150.5 |
| 50 | sessions?client=wallet | 9 | 313 | 100% | 187 | 382 | 429 | 2328 | 134.5 |
| 100 | agents (catalogue) | 17 | 565 | 100% | 197 | 571 | 901 | 2401 | 235.3 |
| 100 | agents/97/2019 (detail) | 17 | 651 | 100% | 160 | 285 | 440 | 2299 | 283.2 |
| 100 | stats | 17 | 656 | 100% | 146 | 173 | 212 | 2302 | 285.0 |
| 100 | sessions?client=wallet | 17 | 601 | 100% | 208 | 417 | 470 | 2348 | 256.0 |
| 250 | agents (catalogue) | 42 | 1602 | 100% | 162 | 419 | 550 | 2878 | 556.6 |
| 250 | agents/97/2019 (detail) | 42 | 998 | 100% | 280 | 1521 | 1865 | 2448 | 407.7 |
| 250 | stats | 42 | 1630 | 100% | 147 | 178 | 222 | 2237 | 728.7 |
| 250 | sessions?client=wallet | 42 | 439 | 100% | 1214 | 3677 | 3889 | 4850 | 90.5 |

The four read paths tested, exactly as `apps/web/src/lib/api.ts` calls them:
`GET /api/agents?limit=24&sort=score`, `GET /api/agents/97/2019`,
`GET /api/stats`, `GET /api/sessions?client=0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713`.

## Repeat of the 250 rung, second sample

Run to show run-to-run spread at the top rung. Same parameters.

| rung | endpoint | invocations | requests | success | p50 ms | p95 ms | p99 ms | wall ms | rps |
|------|----------|-------------|----------|---------|--------|--------|--------|---------|-----|
| 250 | agents (catalogue) | 42 | 1114 | 100% | 215 | 1063 | 1179 | 4013 | 277.6 |
| 250 | agents/97/2019 (detail) | 42 | 1627 | 100% | 152 | 349 | 463 | 2340 | 695.3 |
| 250 | stats | 42 | 1631 | 100% | 139 | 182 | 326 | 2311 | 705.7 |
| 250 | sessions?client=wallet | 42 | 915 | 100% | 440 | 3163 | 3796 | 4820 | 189.8 |

## Reading of the numbers

- The site holds under 250 effective concurrent users. Success rate is 100% at
  every rung, `stats` stays flat (p50 139-150 ms, p95 173-184 ms) all the way to
  250, and the heavy catalogue `agents` path stays near p50 160-230 ms with p95
  under 600 ms in the main run. Nothing degraded into 5xx or timeouts; the only
  failures ever recorded were on the driver's own sockets.
- First bottleneck the cloud numbers implicate: the `/api/sessions` read path.
  It is the only path whose latency climbs with load instead of staying flat.
  At 250 it did only 439 and 915 requests in its window (90-190 rps against
  ~700 rps for `stats`), with p95 3677 ms and p99 3889 ms, and p50 440-1214 ms.
  The cause is visible in the handler: `GET /api/sessions` calls `listTasks(200)`
  and `listJobs(200)` sequentially, each a durable-store read in
  `src/lib/durable-store.ts`, on every request, and the Postgres client is
  created with `max: 1`. Many serverless instances each holding one connection
  and each doing two scans is what turns into the tail at concurrency.
- Second, smaller tail: the catalogue `agents` route p95 wobbles (419 ms in the
  main run, 1063 ms in the repeat). It calls `queryAgents` (the 8004scan upstream
  with a 60 s data cache), `hydrateBoostsFromDb`, and `loadVerifications` per
  request, so its tail rides on an external service. The detail route hits the
  same upstream and showed the same occasional p95 spike (1521 ms once).

## Recommendations (not applied, files under src/ and apps/ were not touched)

- On `/api/sessions`, run the tasks and jobs reads in parallel instead of
  sequentially, and only compute the per-session join when `client` is present.
  Same-page callers already pass `client`.
- Give the durable-store reads a short in-process TTL cache, or reuse the tasks
  and jobs load for a few seconds, so a read-heavy Ongoing page does not issue
  two full scans per request.
- Raise the Postgres pool or route reads through a pooler. `max: 1` per
  serverless instance is a tail-latency source at concurrency, not a throughput one.
- The 8004scan-backed routes would benefit from a stale-while-revalidate read so
  a slow upstream does not surface in p95.

## Limits of this test

- Free plan caps each invocation at 50 subrequests and about 6 sockets, so 250
  effective needs 42 invocations. That is real aggregate concurrency from
  separate isolates, but it is not one process with 250 threads; the load is
  bursty at the sub-second level inside each 2 s window.
- Only read paths were exercised. Write and paid paths were deliberately not
  called: `/api/x402/settle`, `/api/x402/deliver`, `/api/tokens/mint`,
  `/api/cron/*`, `/api/compare/commentary`, `/api/scout/*`, `/api/index/*`.
  Nothing here says how those behave under load.
- Percentiles are measured from Cloudflare's edge to Vercel, not from a real
  browser, and they cover only the four paths above.
- `/api/chain` returns 404 on the live deployment even though the route exists in
  the repo, so it was not tested. Worth checking whether the deployed build is
  behind the source.
- The `sessions` numbers are the noisiest and moved between runs; the two 250
  samples are both reported rather than averaged.
