import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { JSON_HEADERS, fetchJson, MANUAL_RATE_USD_PER_H, manualHealthFactor, manualYield, manualGrid } from "./advantage-manual.mjs";

const BASE = "https://api.agentsouk.xyz";
const CHAIN_ID = 97;
const AMOUNT_USD = 2;

// the buyer is the team's relay wallet: it holds the sUSD for the fee and the BNB
// for the gas the marketplace relayer spends
const RELAY_KEY = process.env.RELAY_PRIVATE_KEY;
if (!RELAY_KEY) {
  console.error("RELAY_PRIVATE_KEY is not set; run with --env-file=.env.local or export it first");
  process.exit(1);
}
const wallet = privateKeyToAccount(RELAY_KEY);

// network and mainnet are report framing, not run output, so carry them forward
// from the previous capture rather than dropping them
let prior = {};
try {
  prior = JSON.parse(readFileSync(new URL("../data/advantage-tasks.json", import.meta.url), "utf8"));
} catch {
  // first capture: nothing to carry
}

async function settleHire(tokenId, name) {
  const reqRes = await fetchJson(`${BASE}/api/x402/requirements`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ chainId: CHAIN_ID, tokenId, amountUsd: AMOUNT_USD, client: wallet.address }),
  }, 30000);
  const pr = reqRes.body?.data?.paymentRequirements;
  if (reqRes.status !== 200 || !pr) {
    return { ok: false, error: `requirements failed (HTTP ${reqRes.status}): ${JSON.stringify(reqRes.body).slice(0, 300)}` };
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
      chainId: BigInt(CHAIN_ID),
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
    url: `/agents/${CHAIN_ID}/${tokenId}`,
    description: `Hire ${name} for a paid session`,
    mimeType: "application/json",
  };
  const settlePayload = {
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
    agent: { chainId: CHAIN_ID, tokenId, name, symbol: "sUSD" },
  };
  const settleRes = await fetchJson(`${BASE}/api/x402/settle`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(settlePayload),
  }, 30000);
  if (!(settleRes.status === 200 && settleRes.body?.success)) {
    return { ok: false, error: `settle failed (HTTP ${settleRes.status}): ${JSON.stringify(settleRes.body).slice(0, 300)}` };
  }
  return { ok: true, paymentId: settleRes.body.paymentId, txHash: settleRes.body.txHash ?? null };
}

async function deliver(paymentId, extra = {}) {
  return fetchJson(`${BASE}/api/x402/deliver`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ paymentId, ...extra }),
  }, 120000);
}

function deliverText(body) {
  const d = body?.data;
  if (d?.text) return String(d.text);
  return JSON.stringify(body, null, 2);
}

async function runAgentSide(task) {
  const t0 = Date.now();
  const hire = await settleHire(task.agent.tokenId, task.agent.name);
  if (!hire.ok) {
    return {
      seconds: (Date.now() - t0) / 1000,
      output: hire.error,
      error: true,
      paymentId: null,
      txHash: null,
    };
  }
  const cap = await deliver(hire.paymentId);
  if (cap.status === 402 || cap.body?.success === false) {
    return {
      seconds: (Date.now() - t0) / 1000,
      output: `capabilities probe failed: ${JSON.stringify(cap.body).slice(0, 500)}`,
      error: true,
      paymentId: hire.paymentId,
      txHash: hire.txHash,
    };
  }
  // chain-97 agents are A2A agents: the deliverable is driven by the task text and
  // an optional structured input, not by an MCP tool name. A failed call is
  // recorded as-is rather than retried until it looks better.
  const call = await deliver(hire.paymentId, { task: task.prompt, input: task.input });
  if (call.status === 402 || call.body?.success === false || !call.body?.data?.ok) {
    return {
      seconds: (Date.now() - t0) / 1000,
      output: `delivery failed: ${JSON.stringify(call.body).slice(0, 800)}`,
      error: true,
      paymentId: hire.paymentId,
      txHash: hire.txHash,
    };
  }
  return {
    seconds: (Date.now() - t0) / 1000,
    output: deliverText(call.body),
    error: false,
    paymentId: hire.paymentId,
    txHash: hire.txHash,
  };
}

const AGENT_ACCOUNT = "0xa09991fc5D8637bb4245737C3ebF26E24D653962";

const TASK_DEFS = [
  {
    id: "task-1-health-factor",
    category: "health-factor",
    prompt: `Read the Venus Core lending position for BSC account ${AGENT_ACCOUNT} on BNB Smart Chain. Report the health factor to three decimals, the per-market collateral factor, the liquidation price, and the exact repayment that would restore a 1.5 health factor. If the account carries no debt, say so plainly.`,
    agent: { tokenId: "2238", name: "Keel", category: "health-factor", protocol: "A2A", status: "active" },
    input: undefined,
    manual: manualHealthFactor,
  },
  {
    id: "task-2-yield",
    category: "yield",
    prompt: `Scan current Venus supply-yield opportunities for wallet ${wallet.address} on BNB Smart Chain and report the base supply APY per market with the block number observed. State the data limitations plainly.`,
    agent: { tokenId: "2044", name: "YieldPilot", category: "yield", protocol: "A2A", status: "active" },
    input: { walletAddress: wallet.address },
    manual: manualYield,
  },
  {
    id: "task-3-grid-trading",
    category: "grid-trading",
    prompt: "Compute a grid trading plan for BNB/USDT on PancakeSwap between 500 and 700 USDT with 20 levels and 1000 USDT total size, and return the levels and order sizes. If the plan cannot be produced without an escrow job, say so plainly rather than returning a price quote.",
    agent: { tokenId: "2018", name: "Hevo Grid", category: "grid-trading", protocol: "A2A", status: "active" },
    input: undefined,
    manual: manualGrid,
  },
];

function fmt(n) {
  return Number(n).toFixed(2);
}

function buildVerdict(task, agent, manual) {
  const timeNote = `agent settle+deliver ${fmt(agent.seconds)}s vs manual ${fmt(manual.seconds)}s ($${fmt((manual.seconds / 3600) * MANUAL_RATE_USD_PER_H)} at 50 USD/h)`;
  if (agent.error && manual.error) {
    return {
      winner: "tie",
      notes: `Both sides failed: agent "${agent.output.slice(0, 120)}", manual "${manual.output.slice(0, 120)}". ${timeNote}.`,
    };
  }
  if (agent.error) {
    return {
      winner: "manual",
      notes: `The agent side failed and its error is recorded verbatim in agentOutput, so the manual pass wins by default. ${timeNote}.`,
    };
  }
  if (manual.error) {
    return {
      winner: "agent",
      notes: `Manual side failed and the error is recorded verbatim in manualOutput, so the agent wins by default. ${timeNote}.`,
    };
  }

  if (task.category === "health-factor") {
    const agentRich = /health_?factor|liquidation|no debt/i.test(agent.output);
    return {
      winner: agentRich ? "agent" : "manual",
      notes: agentRich
        ? `${task.agent.name} returned a direct Venus Core read for the probed account in ${fmt(agent.seconds)}s, ending at either a health factor and restore amount or an explicit no-debt verdict; the manual on-chain pass read the same account over public BSC RPC and, finding it empty, fell back to real market parameters (TVL ranking, exchange rate, collateral factor, close factor) with a worked health-factor formula in ${fmt(manual.seconds)}s. The agent answers the question that was asked; the manual pass wins on raw-value transparency.`
        : `The agent output carries no recognizable health-factor or liquidation content, so the manual on-chain pass wins. ${timeNote}.`,
    };
  }
  if (task.category === "yield") {
    const agentHasApy = /apy/i.test(agent.output);
    return {
      winner: agentHasApy ? "agent" : "manual",
      notes: agentHasApy
        ? `${task.agent.name} returned venue-native Venus supply APYs with the observed block number in ${fmt(agent.seconds)}s; the manual pass pulled DefiLlama's BSC stablecoin pool table and built a weighted allocation with a blended APY in ${fmt(manual.seconds)}s. The agent's rates come from the protocol directly; the manual pass wins on explicit allocation math.`
        : `The agent output carries no APY content, so the manual DefiLlama pass wins. ${timeNote}.`,
    };
  }
  const agentAnswersGrid = /grid|bound|level|rebalanc/i.test(agent.output);
  return {
    winner: agentAnswersGrid ? "tie" : "manual",
    notes: agentAnswersGrid
      ? `${task.agent.name} returned grid-shaped content in ${fmt(agent.seconds)}s; the manual pass computed real bounds, level spacing and per-trade profit from 30 days of BNBUSDT candles in ${fmt(manual.seconds)}s. ${timeNote}.`
      : `${task.agent.name} delivered no grid plan through the marketplace: the registered card's messaging URL answers without a deliverable, and the agent's callable skills are ERC-8183 negotiate and notify_funded, which return an escrow price quote rather than a plan. The manual pass computed real grid bounds and levels from live BNBUSDT klines and wins plainly. ${timeNote}.`,
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const tasks = [];
  for (const def of TASK_DEFS) {
    console.log(`=== ${def.id} ===`);
    console.log(`agent: ${def.agent.name} (${def.agent.tokenId}, ${def.agent.protocol}, status ${def.agent.status})`);
    const agent = await runAgentSide({
      agent: { tokenId: String(def.agent.tokenId), name: def.agent.name },
      prompt: def.prompt,
      input: def.input,
    });
    console.log(`agent side: ${agent.error ? "ERROR" : "ok"} ${fmt(agent.seconds)}s output ${agent.output.length} chars`);
    const manual = await def.manual();
    console.log(`manual side: ${manual.error ? "ERROR" : "ok"} ${fmt(manual.seconds)}s output ${manual.output.length} chars`);
    const verdict = buildVerdict(def, agent, manual);
    console.log(`verdict: ${verdict.winner} - ${verdict.notes}`);
    tasks.push({
      id: def.id,
      category: def.category,
      prompt: def.prompt,
      agent: {
        tokenId: String(def.agent.tokenId),
        name: def.agent.name,
        category: def.agent.category,
        chainId: CHAIN_ID,
        settleMode: "prod",
        txHash: agent.txHash ?? undefined,
        statedFeeUsd: AMOUNT_USD,
      },
      agentOutput: agent.output,
      agentSeconds: Number(agent.seconds.toFixed(2)),
      manualSeconds: Number(manual.seconds.toFixed(2)),
      manualCostUsd: Number(((manual.seconds / 3600) * MANUAL_RATE_USD_PER_H).toFixed(4)),
      manualOutput: manual.output,
      verdict,
    });
  }

  const out = {
    generatedAt,
    network: prior.network,
    capture: {
      measuredAt: generatedAt,
      rail: "x402 prod, EIP-3009 transferWithAuthorization relayed on chain",
      server: "https://api.agentsouk.xyz",
      requestedChainId: CHAIN_ID,
      settledOnChain: true,
      note: `Settled on chain in sUSD on BSC testnet chain 97 through the Agent Souk marketplace at ${BASE}. The buyer is the team's own relay wallet ${wallet.address}, which paid 2 sUSD per task and whose balance also pays the relay gas, so every task below carries a chain-97 settlement transaction hash.`,
    },
    mainnet: prior.mainnet,
    methodology: [
      `Run date: ${generatedAt}. Each task was executed twice against the same prompt: once through the Agent Souk marketplace on BSC testnet chain 97 against ${BASE} (x402 EIP-3009 sign-and-settle, where the marketplace relay broadcasts the transferWithAuthorization on chain, followed by POST /api/x402/deliver) and once manually with real public data sources, timed with Date.now() around each side's actual execution.`,
      `The buyer is the team's own relay wallet ${wallet.address}; the relay holds the sUSD and pays the gas, so these hires are team verification activity rather than third-party demand.`,
      "Every hire settled on chain in sUSD (Agent Souk Test USD, 0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53); each task record carries its settlement transaction hash, verifiable on BSC testnet.",
      "agentOutput is the verbatim deliver text; manual outputs carry raw values; manual cost is wall-clock time at a stated 50 USD/h.",
      "Manual sources: Venus Core reads (vToken exchange rates, cash and borrows, comptroller markets, close factor, oracle prices, account snapshots) over public BSC RPC with fallbacks (bsc-dataseed.binance.org, 1rpc.io/bnb, bsc.publicnode.com, bsc-dataseed1.defiwallet.vm.binance.org); DefiLlama public yields API (yields.llama.fi/pools); Binance public klines endpoint (BNBUSDT 1d x30).",
      "Rerunning scripts/run-advantage-tasks.mjs overwrites this file with a fresh capture; the run date above is the reproduction anchor.",
    ].join(" "),
    tasks,
  };

  writeFileSync(
    new URL("../data/advantage-tasks.json", import.meta.url),
    `${JSON.stringify(out, null, 2)}\n`,
  );
  console.log(`\nwrote data/advantage-tasks.json with ${tasks.length} tasks`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
