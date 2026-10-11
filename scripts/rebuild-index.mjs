#!/usr/bin/env node
// Rebuilds the snapshot the shelf reads through the same route a deployment
// uses, so a local rebuild cannot drift from what ships.
//
// The secret is read from the environment and sent as a bearer header rather
// than a query string, because a request log records the url. It is never
// printed, echoed or written to disk here, and the answer carries counts rather
// than a copy of the snapshot.
//
// EIGHT004_API_KEY is what makes the detail reads affordable: without it the
// registry's anonymous ceiling paces a full declarer sweep into minutes.
// Usage: INDEX_SECRET=... node scripts/rebuild-index.mjs [base] [per]

const base = process.argv[2] ?? process.env.INDEX_BASE_URL ?? "http://localhost:3000";
const per = process.argv[3] ?? process.env.INDEX_PER ?? "60";
// Sent explicitly on every run: the route falls back to the deployment target
// when the chain is absent, so a rebuild aimed at one chain would otherwise
// write the other chain's snapshot.
const chain = process.argv[4] ?? process.env.INDEX_CHAIN ?? "56";

const secret = process.env.INDEX_SECRET;
if (!secret) {
  console.error("INDEX_SECRET is not set, and the route refuses a rebuild without it.");
  process.exit(1);
}

const res = await fetch(`${base}/api/index/build?per=${per}&chain=${chain}`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
});

const body = await res.json().catch(() => null);
if (!res.ok || !body?.success) {
  console.error(`rebuild refused (${res.status}): ${body?.error ?? "no answer body"}`);
  process.exit(1);
}

const s = body.snapshot ?? {};
console.log(`rebuilt chain ${body.chainId} into ${body.written}`);
console.log(`  listings        ${s.total ?? "?"}`);
console.log(`  fetched         ${s.fetched ?? "?"}`);
console.log(`  after dedupe    ${s.deduped ?? "?"}`);
console.log(`  declarers read  ${s.declarers ?? "?"}`);
console.log(`  address found   ${s.endpointsRecovered ?? "?"}`);
console.log(`  seeded applied  ${s.seededApplied ?? "?"}`);

if (Number(s.declarers ?? 0) > 0 && Number(s.endpointsRecovered ?? 0) === 0) {
  // A sweep where every declarer came back empty is a route or key fault, not a
  // registry with no addresses, so it is called out rather than shipped quietly.
  console.error("  WARNING: no declarer returned an address. Check EIGHT004_API_KEY.");
}
