// Run live advantage tests across all four categories against Agent Souk's own
// chain-56 agents. No payment, no receipt store. Manual sides are timed live.
import { writeFileSync } from "node:fs";
import { manualGrid, manualYield, MANUAL_RATE_USD_PER_H } from "./advantage-manual.mjs";

const BASE = "https://api.agentsouk.xyz";
const CHAIN = 56;
const cost = (seconds) => Number(((seconds / 3600) * MANUAL_RATE_USD_PER_H).toFixed(4));

const AGENTS = [
  {
    tokenId: "368655",
    name: "Souk Drift Guard",
    category: "rebalancing",
    task: "Rebalance a 700 USD BNB and 300 USD USDT position to a 50/50 target with a 5 percent band.",
    input: { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50, bandPercent: 5, symbolA: "BNB", symbolB: "USDT" },
  },
  {
    tokenId: "376593",
    name: "Souk Grid Pilot",
    category: "grid-trading",
    task: "Plan a WBNB/USDT grid with a 10 percent width, 11 levels and 100 USD per rung.",
    input: { pair: "WBNB/USDT", widthPct: 10, levels: 11, orderSizeUsd: 100 },
  },
  {
    tokenId: "391003",
    name: "Souk Yield Lens",
    category: "yield",
    task: "Project the net yield on 10000 USD at a 12 percent gross APY, monthly compounding and a 2 percent fee.",
    input: { principalUsd: 10000, grossApyPercent: 12, compoundingPerYear: 12, feeBps: 200 },
  },
  {
    tokenId: "404603",
    name: "Souk Health Guard",
    category: "health-factor",
    task: "Collateral value is 1000 USD, debt value is 600 USD, liquidation threshold is 0.8. What is the health factor?",
  },
];

async function json(url, init = {}, ms = 25000) {
  const t0 = Date.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // keep null
  }
  return { status: res.status, seconds: (Date.now() - t0) / 1000, body, text };
}

function clip(value, n = 1200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, n);
}

function taskText(body, fallback) {
  const task = body?.result?.task ?? body?.result;
  return clip(
    task?.status?.message?.parts?.[0]?.text
    ?? task?.message?.parts?.[0]?.text
    ?? task?.artifact?.parts?.[0]?.text
    ?? body?.error?.message
    ?? fallback,
  );
}

function taskState(body) {
  const task = body?.result?.task ?? body?.result;
  return task?.status?.state ?? task?.state ?? null;
}

async function probe(agent) {
  const detail = await json(`${BASE}/api/agents/${CHAIN}/${agent.tokenId}`, {}, 15000);
  const data = detail.body?.data;
  const cardUrl = data?.a2a_endpoint;
  if (!cardUrl) throw new Error(`${agent.name} has no a2a endpoint`);
  const messageUrl = cardUrl.endsWith("/.well-known/agent-card.json")
    ? cardUrl.replace(/\/\.well-known\/agent-card\.json$/, "/a2a")
    : cardUrl;
  const parts = [{ kind: "text", text: agent.task }];
  if (agent.input) parts.push({ kind: "data", data: { input: agent.input } });
  const message = await json(messageUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: { message: { role: "user", messageId: `advantage-${agent.tokenId}`, parts } },
    }),
  }, 30000);
  return {
    status: message.status,
    seconds: message.seconds,
    state: taskState(message.body),
    output: taskText(message.body, message.text),
    messageUrl,
  };
}

function manualRebalance() {
  const t0 = Date.now();
  const valueA = 700;
  const valueB = 300;
  const total = valueA + valueB;
  const current = (valueA / total) * 100;
  const target = 50;
  const drift = current - target;
  const move = (drift / 100) * total;
  return {
    seconds: (Date.now() - t0) / 1000,
    output: JSON.stringify({
      totalUsd: total,
      currentAPercent: current,
      targetAPercent: target,
      driftPercent: drift,
      moveUsd: Number(Math.abs(move).toFixed(2)),
      action: drift > 0 ? "sell A for B" : drift < 0 ? "buy A with B" : "hold",
    }),
  };
}

function manualHealth() {
  const t0 = Date.now();
  const collateral = 1000;
  const debt = 600;
  const threshold = 0.8;
  const hf = (collateral * threshold) / debt;
  return {
    seconds: (Date.now() - t0) / 1000,
    output: JSON.stringify({
      healthFactor: Number(hf.toFixed(4)),
      liquidationCapacity: collateral * threshold,
      additionalDebtBeforeLiquidation: collateral * threshold - debt,
      liquidationDistancePercent: Number((((collateral * threshold - debt) / collateral) * 100).toFixed(2)),
    }),
  };
}

const live = [];
for (const agent of AGENTS) {
  const result = await probe(agent);
  live.push({ agent, result });
  console.log(`${agent.name}: ${result.state} in ${result.seconds.toFixed(2)}s`);
}

const manualRebalanceResult = manualRebalance();
const manualGridResult = await manualGrid();
const manualYieldResult = await manualYield();
const manualHealthResult = manualHealth();

const manualByCategory = {
  rebalancing: manualRebalanceResult,
  "grid-trading": manualGridResult,
  yield: manualYieldResult,
  "health-factor": manualHealthResult,
};

const tasks = live.map(({ agent, result }, i) => {
  const manual = manualByCategory[agent.category];
  const answered = result.state === "completed" || result.state === "input-required";
  return {
    id: `task-${i + 1}-${agent.category}`,
    category: agent.category,
    prompt: agent.task,
    agent: {
      tokenId: agent.tokenId,
      name: agent.name,
      category: agent.category,
      chainId: CHAIN,
      settleMode: "probe",
      txHash: null,
      statedFeeUsd: 0,
    },
    agentOutput: result.output,
    agentSeconds: result.seconds,
    manualSeconds: manual.seconds,
    manualCostUsd: cost(manual.seconds),
    manualOutput: manual.output,
    verdict: {
      winner: answered ? "agent" : "manual",
      notes: answered
        ? `${agent.name} answered the live ${agent.category} task on chain ${CHAIN} in ${result.seconds.toFixed(2)}s with task state ${result.state}. The manual side took ${manual.seconds.toFixed(2)}s at $${cost(manual.seconds).toFixed(2)}. This is a live A2A test, not a paid hire.`
        : `${agent.name} did not complete the live ${agent.category} task. The manual side is recorded.`,
    },
  };
});

const data = {
  generatedAt: new Date().toISOString(),
  network: {
    key: "mainnet",
    status: "current",
    chainId: CHAIN,
    name: "BNB Smart Chain",
    asset: { symbol: "USDT", name: "Tether USD", address: "0x55d398326f99059fF775485246999027B3197955" },
    explorer: "https://bscscan.com",
  },
  capture: {
    measuredAt: new Date().toISOString(),
    rail: "live A2A, chain 56",
    server: BASE,
    requestedChainId: CHAIN,
    settledOnChain: false,
    note:
      "Four live A2A tests against Agent Souk's own chain-56 agents, one per category. No payment, hire or receipt store read. The manual sides were timed live.",
  },
  methodology:
    "Each category was run live against an Agent Souk owned chain-56 listing through its A2A messaging path, with a short task and a structured input part where the agent requires one. Agent time is the live HTTP round trip from the probe. The manual side was timed live against public data, except the deterministic rebalancing and health arithmetic. Manual cost is wall-clock time at 50 USD per hour. This is a liveness and output comparison, not a paid hire.",
  tasks,
};

writeFileSync("data/advantage-tasks.json", JSON.stringify(data, null, 2));
console.log(JSON.stringify(tasks.map((t) => ({
  category: t.category,
  agent: t.agent.name,
  state: live.find((l) => l.agent.tokenId === t.agent.tokenId)?.result.state,
  agentSeconds: t.agentSeconds,
  manualSeconds: t.manualSeconds,
  winner: t.verdict.winner,
})), null, 2));
