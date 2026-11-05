// Assemble the first-party vs third-party vs manual advantage capture.
// Read-only: the agent rows are delivered hires already on record; the manual
// sides are timed live in this script.
import { readFileSync, writeFileSync } from "node:fs";
import { MANUAL_RATE_USD_PER_H } from "./advantage-manual.mjs";

const OUT = "data/advantage-first-party-tasks.json";
const prior = JSON.parse(readFileSync("data/advantage-tasks.json", "utf8"));
const ours = JSON.parse(readFileSync("data/advantage-ours.json", "utf8"));
const vault = JSON.parse(readFileSync("data/advantage-vault-tasks.json", "utf8"));

const cost = (seconds) => Number(((seconds / 3600) * MANUAL_RATE_USD_PER_H).toFixed(4));

function manualHealthArithmetic() {
  const t0 = Date.now();
  const collateral = 10000;
  const debt = 6500;
  const threshold = 0.8;
  const healthFactor = (collateral * threshold) / debt;
  const capacity = collateral * threshold;
  const distance = (capacity - debt) / collateral;
  return {
    seconds: (Date.now() - t0) / 1000,
    output: JSON.stringify({
      healthFactor: Number(healthFactor.toFixed(4)),
      liquidationCapacity: capacity,
      additionalDebtBeforeLiquidation: capacity - debt,
      liquidationDistancePercent: Number((distance * 100).toFixed(2)),
    }),
  };
}

const healthOurs = ours.tasks.find((t) => t.category === "health-factor");
const healthThird = prior.tasks.find((t) => t.category === "health-factor");
const yieldThird = prior.tasks.find((t) => t.category === "yield");
const yieldOurs = ours.tasks.find((t) => t.category === "yield");
const vaultTask = vault.tasks.find((t) => t.kind === "vault");
const healthManual = manualHealthArithmetic();
const vaultManualOperatingSeconds = vaultTask.vault.windowSeconds;
const vaultManualOperatingCost = cost(vaultManualOperatingSeconds);

const tasks = [
  {
    id: "task-1-health-factor",
    category: "health-factor",
    prompt: healthOurs.prompt,
    firstParty: {
      ...healthOurs.agent,
      agentSeconds: healthOurs.agentSeconds,
      agentCostUsd: healthOurs.agent.statedFeeUsd,
      quality: healthOurs.quality,
      agentOutput: healthOurs.agentOutput,
    },
    manual: {
      seconds: healthManual.seconds,
      costUsd: cost(healthManual.seconds),
      output: healthManual.output,
      note: "Manual arithmetic on the same inputs the first-party agent answered.",
    },
    payoff: {
      agentCostUsd: healthOurs.agent.statedFeeUsd,
      manualCostUsd: cost(healthManual.seconds),
      netUsd: Number((cost(healthManual.seconds) - healthOurs.agent.statedFeeUsd).toFixed(4)),
      winner: "manual",
      note: "The task is simple arithmetic. The agent is more expensive than the manual answer, and the payoff is negative.",
    },
    verdict: {
      winner: "manual",
      notes:
        "Souk Health Guard answered the deterministic health-factor task in 267.51s and returned structured JSON with health factor 1.2308. The manual arithmetic on the same inputs took effectively 0s at $0.00. Manual wins on payoff; the first-party agent wins on structured output.",
    },
  },
  {
    id: "task-2-yield",
    category: "yield",
    prompt: yieldThird.prompt,
    firstParty: {
      status: "not-captured",
      agent: { tokenId: "391003", name: "Souk Yield Lens", category: "yield", chainId: 56 },
      note: "Vault-only agent. No delivered x402 hire and no live vault hire in this window.",
    },
    manual: {
      seconds: yieldOurs.manualSeconds,
      costUsd: yieldOurs.manualCostUsd,
      output: yieldOurs.manualOutput,
    },
    payoff: {
      agentCostUsd: null,
      manualCostUsd: yieldOurs.manualCostUsd,
      netUsd: null,
      winner: "not-captured",
      note: "No first-party agent side to price.",
    },
    verdict: {
      winner: "not-captured",
      notes:
        "Souk Yield Lens is vault-only and has no delivered hire, so there is no first-party agent side. The manual DefiLlama pass is recorded as the reference run only.",
    },
  },
  {
    id: "task-3-vault-grid",
    category: "grid-trading",
    prompt: "Execute a funded grid hire inside HireVault and report the realized result.",
    firstParty: {
      agent: vaultTask.agent,
      vault: vaultTask.vault,
      agentSeconds: vaultTask.agentSeconds,
      agentCostUsd: Number(Math.abs(vaultTask.vault.realizedPnlUsd).toFixed(6)),
      agentOutput: vaultTask.agentOutput,
      note: "First-party team verification activity, not third-party marketplace demand.",
    },
    manual: {
      seconds: vaultTask.manualSeconds,
      costUsd: vaultTask.manualCostUsd,
      operatingSeconds: vaultManualOperatingSeconds,
      operatingCostUsd: vaultManualOperatingCost,
      output: vaultTask.manualOutput,
      note: "Plan time is 4.27s. Operating the same position for the full 47m15s window is costed at 50 USD per hour.",
    },
    payoff: {
      agentCostUsd: Number(Math.abs(vaultTask.vault.realizedPnlUsd).toFixed(6)),
      manualCostUsd: vaultManualOperatingCost,
      netUsd: Number((vaultManualOperatingCost - Math.abs(vaultTask.vault.realizedPnlUsd)).toFixed(4)),
      winner: "agent",
      note: "The agent pays for itself if a human would have watched the position for the full window. At five minutes of attention, manual cost is $4.17 and the agent still wins.",
    },
    verdict: {
      winner: "agent",
      notes:
        "The first-party vault agent executed a real hire for 47m15s, traded twice and returned 9.996202 USDT from a 10 USDT deposit, a realized execution cost of 0.003798 USDT. Manual planning took 4.27s at $0.06, but operating the position for the same window costs $39.37 at 50 USD per hour. The agent wins on payoff; the manual side is faster only because it does not execute.",
    },
  },
];

const out = {
  assembledAt: new Date().toISOString(),
  kind: "first-party-vs-manual",
  network: prior.network,
  methodology:
    "First-party agent rows are delivered hires already on record: Souk Health Guard 2504 on chain 97 and the real chain-56 HireVault hire 2 by Souk Grid Pilot. The manual health arithmetic was timed live on the first-party prompt; the manual yield and grid sides use the live runs from the same assembly window. No new hire or transaction was created. Manual cost is wall-clock time at 50 USD per hour. Agent time is the marketplace task window for x402 and the first-to-last receipt window for the vault.",
  tasks,
  thirdPartyReference: [
    {
      category: "health-factor",
      agent: healthThird.agent,
      agentSeconds: healthThird.agentSeconds,
      agentCostUsd: healthThird.agent.statedFeeUsd,
      agentOutput: healthThird.agentOutput,
      note: "Different prompt: Keel answered the Venus Core account read, not the deterministic arithmetic task. Not used for the first-party verdict.",
    },
    {
      category: "yield",
      agent: yieldThird.agent,
      agentSeconds: yieldThird.agentSeconds,
      agentCostUsd: yieldThird.agent.statedFeeUsd,
      agentOutput: yieldThird.agentOutput,
      note: "Sluicegate declined the yield question. Not used for the first-party verdict.",
    },
  ],
  notCaptured: [
    "Souk Yield Lens vault hire: no live hire in this window.",
    "Souk Drift Guard, Souk Band Keeper, Souk Grid Planner: no live hire in this window.",
    "Health-factor vault lane: no Porter sweep wired.",
  ],
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`wrote ${OUT}`);
for (const t of tasks) console.log(`${t.id}: ${t.verdict.winner}`);
