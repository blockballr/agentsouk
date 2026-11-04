#!/usr/bin/env node
// Derives data/coverage.json from the committed snapshot, so the twice-daily
// rebuild publishes a funnel that matches the agents file it just wrote.
// Usage: node scripts/write-coverage.mjs <chainId>

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const snapshotPath = fileURLToPath(new URL("../data/agents.json", import.meta.url));
const outPath = fileURLToPath(new URL("../data/coverage.json", import.meta.url));

const chainId = Number(process.argv[2]);
if (!Number.isInteger(chainId) || chainId <= 0) {
  console.error("usage: node scripts/write-coverage.mjs <chainId>");
  process.exit(1);
}

let text;
try {
  text = await readFile(snapshotPath, "utf8");
} catch (err) {
  console.error(`cannot read ${snapshotPath}: ${err.code ?? err.message}`);
  process.exit(1);
}

let snapshot;
try {
  snapshot = JSON.parse(text);
} catch (err) {
  console.error(`${snapshotPath} is not valid JSON: ${err.message}`);
  process.exit(1);
}

const agents = snapshot?.agents;
if (!Array.isArray(agents) || agents.length === 0) {
  console.error(`${snapshotPath} holds no agents, so there is no funnel to report.`);
  process.exit(1);
}

// Every row carries the chain it came from, so a snapshot written for another
// chain is refused rather than labelled as this one.
const foreign = [
  ...new Set(
    agents
      .filter((a) => Number(a?.chain_id) !== chainId)
      .map((a) => a?.chain_id ?? "unknown"),
  ),
];
if (foreign.length > 0) {
  console.error(`${snapshotPath} is not chain ${chainId}: it holds agents for chain ${foreign.join(", ")}.`);
  process.exit(1);
}

const source = snapshot.source;
if (!source || typeof source !== "object") {
  console.error(`${snapshotPath} has no source funnel.`);
  process.exit(1);
}

const counts = snapshot.counts;
if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
  console.error(`${snapshotPath} has no per-category counts.`);
  process.exit(1);
}

if (typeof snapshot.snapshotTime !== "string" || snapshot.snapshotTime === "") {
  console.error(`${snapshotPath} has no snapshotTime.`);
  process.exit(1);
}

const coverage = {
  chainId,
  snapshotTime: snapshot.snapshotTime,
  funnel: {
    fetched: source.fetched ?? null,
    upstreamTotal: source.upstreamTotal ?? null,
    deduped: source.deduped ?? null,
    selected: agents.length,
    registryTotal: source.upstreamTotal ?? null,
    declarers: source.declarers ?? null,
    endpointsRecovered: source.endpointsRecovered ?? null,
    seededApplied: source.seededApplied ?? null,
  },
  counts,
};

await writeFile(outPath, JSON.stringify(coverage, null, 2), "utf8");
console.log(
  `wrote ${outPath}: chain ${chainId}, ${coverage.funnel.selected} selected from ${coverage.funnel.fetched ?? "?"} fetched`,
);
