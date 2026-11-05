// Assemble the post-deadline advantage capture: the two existing x402 hires
// with the manual side re-run live, plus the real chain-56 vault hire 2.
// Read-only: no keys, no transactions.
import { readFileSync, writeFileSync } from "node:fs";
import { manualHealthFactor, manualYield, manualGrid, MANUAL_RATE_USD_PER_H } from "./advantage-manual.mjs";

const BASE = "https://api.agentsouk.xyz";
const OUT = "data/advantage-vault-tasks.json";
const PRIOR = "data/advantage-tasks.json";

const manualCost = (seconds) => Number(((seconds / 3600) * MANUAL_RATE_USD_PER_H).toFixed(4));

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

function x402Task(prior, category, manual) {
  const task = prior.tasks.find((t) => t.category === category);
  if (!task) throw new Error(`no prior ${category} capture`);
  return {
    ...task,
    manualSeconds: manual.seconds,
    manualCostUsd: manualCost(manual.seconds),
    manualOutput: manual.output,
    manualError: manual.error,
    verdict: {
      ...task.verdict,
      notes: task.verdict.notes.replace(/manual \d+\.\d+s \(\$\d+\.\d+ at 50 USD\/h\)/, `manual ${manual.seconds.toFixed(2)}s ($${manualCost(manual.seconds).toFixed(2)} at 50 USD/h)`),
    },
  };
}

async function vaultTask(manual) {
  const body = await json(`${BASE}/api/vault/receipts?chainId=56&hireId=2`);
  const receipts = Array.isArray(body.receipts) ? body.receipts : [];
  if (receipts.length === 0) throw new Error("vault hire 2 returned no receipts");
  const traded = receipts.filter((r) => r.status === "traded").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const first = receipts[receipts.length - 1];
  const last = receipts[0];
  const startValue = Number(traded[0]?.before?.value0 ?? first?.before?.value0 ?? 0) / 1e18;
  const endValue = Number(traded[traded.length - 1]?.after?.value0 ?? 0) / 1e18;
  const windowSeconds = Number(((Date.parse(last.createdAt) - Date.parse(first.createdAt)) / 1000).toFixed(2));
  return {
    id: "task-3-vault-grid",
    category: "grid-trading",
    kind: "vault",
    agent: {
      tokenId: "376593",
      name: "Souk Grid Pilot",
      category: "grid-trading",
      chainId: 56,
      policy: "grid",
      wallet: "0x5d328e476f9d81bb52dbaa37895804775e49731f",
    },
    vault: {
      address: "0x028129c230123a46f4305ce0d2b29f8ac5255149",
      hireId: "2",
      depositUsd: 10,
      openedAt: first.createdAt,
      lastAt: last.createdAt,
      windowSeconds,
      receipts: receipts.length,
      traded: traded.length,
      refused: receipts.filter((r) => r.status === "refused").length,
      skipped: receipts.filter((r) => r.status === "skipped").length,
      startValueUsd: Number(startValue.toFixed(6)),
      endValueUsd: Number(endValue.toFixed(6)),
      realizedPnlUsd: Number((endValue - startValue).toFixed(6)),
      pnlPct: Number((((endValue - startValue) / startValue) * 100).toFixed(4)),
      txHashes: traded.map((r) => r.txHash).filter(Boolean),
    },
    agentOutput: JSON.stringify({
      policy: "Grid",
      hireId: "2",
      depositUsd: 10,
      startValueUsd: Number(startValue.toFixed(6)),
      endValueUsd: Number(endValue.toFixed(6)),
      realizedPnlUsd: Number((endValue - startValue).toFixed(6)),
      trades: traded.length,
      refused: receipts.filter((r) => r.status === "refused").length,
      skipped: receipts.filter((r) => r.status === "skipped").length,
    }, null, 2),
    agentSeconds: windowSeconds,
    manualSeconds: manual.seconds,
    manualCostUsd: manualCost(manual.seconds),
    manualOutput: manual.output,
    manualError: manual.error,
    verdict: {
      winner: "manual",
      notes: `The vault agent executed inside a ${Math.floor(windowSeconds / 60)}m ${Math.round(windowSeconds % 60)}s window and returned ${endValue.toFixed(6)} USDT from a 10 USDT deposit, a realized execution cost of ${Math.abs(endValue - startValue).toFixed(6)} USDT. The manual pass computed a grid plan in ${manual.seconds.toFixed(2)}s at $${manualCost(manual.seconds).toFixed(2)}. Manual wins on time and cost; the vault is the only side that actually executed.`,
    },
  };
}

const prior = JSON.parse(readFileSync(PRIOR, "utf8"));
const health = await manualHealthFactor();
const yieldManual = await manualYield();
const grid = await manualGrid();
const tasks = [
  x402Task(prior, "health-factor", health),
  x402Task(prior, "yield", yieldManual),
  await vaultTask(grid),
];
const out = {
  assembledAt: new Date().toISOString(),
  kind: "retrospective",
  network: prior.network,
  methodology:
    "The two x402 agent captures are the delivered chain-97 hires recorded in data/advantage-tasks.json; their manual sides were re-run live on 5 November 2026. The vault capture is the real chain-56 HireVault hire 2, read from the receipt store and the on-chain trade rows. No new hire or transaction was created for this report. Manual cost is wall-clock time at 50 USD per hour.",
  tasks,
  notCaptured: [
    { category: "yield", reason: "No live hire of the first-party Souk Yield Lens vault agent exists on chain 56; the agent is listed and executor-ready, but no funded hire has executed." },
    { category: "health-factor", reason: "No health-factor vault lane is wired. The Porter sweep is not called by /api/vault/execute, and the first-party health agent is an escrow seller, not a vault agent." },
    { category: "grid-trading", reason: "No third-party grid agent has a delivered paid hire in the current marketplace. Chain-97 grid agents quote an ERC-8183 job rather than deliver a plan." },
  ],
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`wrote ${OUT}`);
for (const t of tasks) console.log(`${t.id}: agent ${t.agentSeconds}s, manual ${t.manualSeconds}s, winner ${t.verdict.winner}`);
