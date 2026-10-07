// One genuine hire per chain-97 category. For each category we fetch payment
// requirements from the marketplace, sign an EIP-3009 authorization with the
// buyer key, settle it (through the marketplace API when it relays on chain,
// otherwise directly on chain), then invoke the agent's own A2A endpoint and
// grade the reply with the same structural scorer the marketplace uses.
//
// Usage: node scripts/real-hire-chain97.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  encodeFunctionData,
  parseSignature,
} from "viem";
import { bscTestnet } from "viem/chains";

const API = process.env.SOUK_API ?? "https://api.agentsouk.xyz";
const CHAIN_ID = 97;
const AMOUNT_USD = 2;
const EXPLORER = "https://testnet.bscscan.com";
const SUSD = getAddress("0x9332b1aa9b3d5826f0b9b9e1659d962d2da13a53");
const RPC = "https://data-seed-prebsc-2-s2.binance.org:8545";
const SANDBOX_TX_PREFIX = "0x53a66f";


// env + clients

function parseEnv(path) {
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    env[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = parseEnv(fileURLToPath(new URL("../.env.local", import.meta.url)));
if (!env.RELAY_PRIVATE_KEY || !env.PROD_BUYER_KEY) {
  console.error("RELAY_PRIVATE_KEY or PROD_BUYER_KEY missing from .env.local");
  process.exit(1);
}
const buyer = privateKeyToAccount(env.PROD_BUYER_KEY);
const relay = privateKeyToAccount(env.RELAY_PRIVATE_KEY);

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC, { timeout: 30000 }) });
const relayWallet = createWalletClient({ account: relay, chain: bscTestnet, transport: http(RPC, { timeout: 30000 }) });

// the analysis wallet for the read-only agents: our own relay address, which
// holds real testnet tBNB, so the scan has actual holdings to report
const ANALYSIS_WALLET = getAddress(relay.address);


// mirrors src/lib/quality.ts: parseA2A + scoreDelivery

const FAILED_STATES = new Set(["failed", "rejected", "canceled", "cancelled"]);
const PENDING_STATES = new Set(["submitted", "working", "input-required", "unknown"]);

function parseA2A(raw) {
  const empty = { state: undefined, text: "", parts: 0, isJson: false };
  let value = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return empty;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { value = JSON.parse(trimmed); } catch { return { state: undefined, text: trimmed, parts: 1, isJson: false }; }
    } else {
      return { state: undefined, text: trimmed, parts: 1, isJson: false };
    }
  }
  if (!value || typeof value !== "object") return empty;
  const obj = value;
  const state =
    (obj.status && typeof obj.status.state === "string" && obj.status.state) ||
    (typeof obj.state === "string" && obj.state) ||
    undefined;
  const parts = [];
  const collect = (input) => {
    if (!input) return;
    if (Array.isArray(input)) { input.forEach(collect); return; }
    if (typeof input === "string") { parts.push(input); return; }
    if (typeof input !== "object") return;
    if (typeof input.text === "string") parts.push(input.text);
    else if (typeof input.value === "string") parts.push(input.value);
    else if (input.data !== undefined) parts.push(JSON.stringify(input.data));
    else if (input.parts !== undefined) collect(input.parts);
  };
  if (obj.result) {
    if (Array.isArray(obj.result.artifacts)) obj.result.artifacts.forEach(collect);
    collect(obj.result.status);
  }
  collect(obj.artifacts);
  collect(obj.message);
  collect(obj.parts);
  collect(obj.content);
  if (typeof obj.text === "string") parts.push(obj.text);
  const text = parts.map((p) => p.trim()).filter(Boolean).join("\n").trim();
  const isJson =
    typeof raw === "string" ? raw.trim().startsWith("{") || raw.trim().startsWith("[") : Boolean(obj.result?.artifacts || obj.artifacts);
  return { state, text, parts: parts.length, isJson };
}

function scoreDelivery(raw) {
  const reply = parseA2A(raw);
  const state = reply.state?.toLowerCase();
  if (state && FAILED_STATES.has(state)) return { score: 0, grade: "poor", reason: `agent reported ${state}` };
  if (state && PENDING_STATES.has(state)) return { score: 0.15, grade: "poor", reason: `agent returned ${state} rather than a result` };
  const text = reply.text.trim();
  if (!text) return { score: 0, grade: "poor", reason: "no artifact or text in the reply" };
  if (/^\s*<(!doctype|html)/i.test(text)) return { score: 0, grade: "poor", reason: "reply was an HTML page, not an answer" };
  let score = 0.4;
  if (reply.parts > 0) score += 0.2;
  if (reply.isJson) score += 0.15;
  if (state === "completed") score += 0.15;
  if (text.length >= 40) score += 0.08;
  if (text.length >= 120) score += 0.07;
  if (/\d/.test(text)) score += 0.05;
  if (/\b(error|failed|unauthorized|not found|exception)\b/i.test(text)) score -= 0.25;
  score = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  const grade = score >= 0.65 ? "good" : score >= 0.35 ? "partial" : "poor";
  const reason =
    grade === "good"
      ? reply.parts > 0 ? `completed with ${reply.parts} artifact part${reply.parts === 1 ? "" : "s"}` : "completed with a substantive reply"
      : grade === "partial" ? "answered, but thinly" : "weak, empty or error-shaped";
  return { score, grade, reason };
}

// pull the agent answer out of the reply shapes the chain-97 agents actually
// return: A2A text parts, artifacts (some nested under result.task), or a
// JSON-RPC error
function extractDeliverable(body) {
  if (!body) return "";
  if (body.error) return body.error.message ?? JSON.stringify(body.error);
  const r = body.result ?? body;
  const chunks = [];
  const push = (s) => { if (typeof s === "string" && s.trim()) chunks.push(s.trim()); };
  const fromParts = (parts) => {
    for (const p of parts ?? []) {
      if (typeof p?.text === "string") push(p.text);
      else if (p?.data !== undefined) push(JSON.stringify(p.data));
    }
  };
  if (Array.isArray(r.parts)) fromParts(r.parts);
  if (Array.isArray(r.artifacts)) r.artifacts.forEach((a) => fromParts(a.parts));
  if (r.task) {
    if (Array.isArray(r.task.artifacts)) r.task.artifacts.forEach((a) => fromParts(a.parts));
    if (r.task.status?.message?.parts) fromParts(r.task.status.message.parts);
  }
  if (chunks.length) return chunks.join("\n");
  return JSON.stringify(r);
}


// settlement

const TWA_ABI = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
];

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

function splitSig(sig) {
  const s = sig.slice(2);
  const r = `0x${s.slice(0, 64)}`;
  const vs = `0x${s.slice(64, 128)}`;
  let vNum = parseInt(s.slice(128, 130), 16);
  if (vNum < 27) vNum += 27;
  return { r, vs, vNum };
}

async function ensureBuyerFunded(minWei) {
  const bal = await publicClient.readContract({
    address: SUSD,
    abi: [{ name: "balanceOf", type: "function", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
    functionName: "balanceOf",
    args: [buyer.address],
  });
  if (bal >= minWei) return { funded: true, minted: null };
  const need = minWei - bal;
  const hash = await relayWallet.writeContract({
    address: SUSD,
    abi: [{ name: "mint", type: "function", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }],
    functionName: "mint",
    args: [buyer.address, need],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { funded: true, minted: hash };
}

async function requirements(tokenId) {
  const res = await fetch(`${API}/api/x402/requirements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId: CHAIN_ID, tokenId, amountUsd: AMOUNT_USD, client: buyer.address }),
  });
  const body = await res.json();
  if (!res.ok || !body?.data?.paymentRequirements) throw new Error(`requirements failed (${res.status})`);
  return body.data.paymentRequirements;
}

async function signAuthorization(pr) {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const now = block.timestamp;
  const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
  const message = {
    from: buyer.address,
    to: getAddress(pr.payTo),
    value: BigInt(pr.amount),
    validAfter: now - 60n,
    validBefore: now + 300n,
    nonce,
  };
  const signature = await buyer.signTypedData({
    domain: { name: pr.extra.name, version: pr.extra.version, chainId: BigInt(CHAIN_ID), verifyingContract: getAddress(pr.asset) },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });
  return { message, signature, rawSignature: parseSignature(signature) };
}

// settles via the marketplace API; returns { ok, mode, txHash, paymentId } when
// the API relayed a real transaction, otherwise ok:false so we can settle directly
async function settleViaApi(pr, signed, tokenId, name) {
  const resource = { url: `/agents/${CHAIN_ID}/${tokenId}`, description: `Hire ${name} for a paid session`, mimeType: "application/json" };
  const paymentId = `hire${signed.message.nonce.slice(2, 14)}`;
  const payload = {
    paymentId,
    paymentPayload: {
      x402Version: 2,
      payload: {
        authorization: {
          from: buyer.address,
          to: pr.payTo,
          value: signed.message.value.toString(),
          validAfter: signed.message.validAfter.toString(),
          validBefore: signed.message.validBefore.toString(),
          nonce: signed.message.nonce,
          signature: signed.signature,
        },
        resource,
      },
      resource,
      accepted: pr,
    },
    paymentRequirements: pr,
    agent: { chainId: CHAIN_ID, tokenId, name, symbol: "sUSD" },
    amountUsd: AMOUNT_USD,
  };
  try {
    const res = await fetch(`${API}/api/x402/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    const txHash = body?.txHash ?? "";
    const real = /^0x[0-9a-fA-F]{64}$/.test(txHash) && !txHash.toLowerCase().startsWith(SANDBOX_TX_PREFIX);
    return { ok: Boolean(res.ok && body?.success && real), body, txHash, paymentId, mode: body?.details?.mode ?? null };
  } catch (e) {
    return { ok: false, body: { error: e.message }, txHash: "", paymentId, mode: null };
  }
}

async function settleDirect(pr, signed) {
  const { r, vs, vNum } = splitSig(signed.signature);
  const data = encodeFunctionData({
    abi: TWA_ABI,
    functionName: "transferWithAuthorization",
    args: [
      getAddress(buyer.address),
      getAddress(pr.payTo),
      signed.message.value,
      signed.message.validAfter,
      signed.message.validBefore,
      signed.message.nonce,
      vNum,
      r,
      vs,
    ],
  });
  const hash = await relayWallet.sendTransaction({ to: getAddress(pr.asset), data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`relay tx reverted: ${hash}`);
  return hash;
}


// delivery

async function deliverA2a(endpoint, task, data) {
  const parts = [{ kind: "text", text: task }];
  if (data) parts.push({ kind: "data", data });
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: { message: { role: "user", kind: "message", messageId: `souk-${Date.now()}-${Math.random().toString(16).slice(2)}`, parts } },
    }),
  }).catch((e) => ({ status: 0, text: async () => `request failed: ${e.message}` }));
  const raw = await res.text();
  let body = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  return { httpStatus: res.status, raw, body };
}


// plan: one agent per category. The task is written for the agent's own card.

const PLAN = [
  {
    category: "yield",
    tokenId: "2044",
    name: "YieldPilot",
    registryEndpoint: "https://spotriq-production.up.railway.app/v1/reference-agents/yieldpilot/.well-known/agent-card.json",
    messagingUrl: "https://spotriq-production.up.railway.app/v1/reference-agents/yieldpilot/a2a",
    task: `Scan the current Venus supply-yield opportunities on BNB Smart Chain for wallet ${ANALYSIS_WALLET} and report the current base supply APY per market with the block number observed.`,
    data: { input: { walletAddress: ANALYSIS_WALLET } },
  },
  {
    category: "health-factor",
    tokenId: "2046",
    name: "VenusGuard",
    registryEndpoint: "https://spotriq-production.up.railway.app/v1/reference-agents/venusguard/.well-known/agent-card.json",
    messagingUrl: "https://spotriq-production.up.railway.app/v1/reference-agents/venusguard/a2a",
    task: `Inspect the Venus Core and isolated lending position for wallet ${ANALYSIS_WALLET} on BNB Smart Chain and report the account liquidity, any shortfall and the health state.`,
    data: { input: { walletAddress: ANALYSIS_WALLET } },
  },
  {
    category: "rebalancing",
    tokenId: "2017",
    name: "RangeKeeper",
    registryEndpoint: "https://spotriq-production.up.railway.app/v1/reference-agents/rangekeeper/.well-known/agent-card.json",
    messagingUrl: "https://spotriq-production.up.railway.app/v1/reference-agents/rangekeeper/a2a",
    task: "Analyse PancakeSwap V3 position 1 on BNB Smart Chain and report the current range state, tick, price and liquidity.",
    data: { input: { tokenId: "1" } },
  },
  {
    category: "grid-trading",
    tokenId: "2018",
    name: "Hevo Grid",
    registryEndpoint: "https://hevo-agents.fly.dev/grid/.well-known/agent-card.json",
    messagingUrl: "https://hevo-agents.fly.dev/grid/a2a",
    task: "Compute a grid trading plan for BNB/USDT on PancakeSwap between 500 and 700 USDT with 20 levels and 1000 USDT total size, and return the levels and order sizes.",
    data: { skill: "grid_plan", pair: "BNB/USDT", lower: 500, upper: 700, levels: 20, size_usdt: 1000 },
    note: "The reply is an ERC-8183 price quote, not a grid plan. Hevo Grid gates the actual work behind its own escrow, so no grid deliverable is obtainable through an x402 hire.",
  },
];


// run

const results = {};
const funding = await ensureBuyerFunded(BigInt(PLAN.length) * 2n * 10n ** 18n + 10n ** 18n);
const fundingNote = funding.minted
  ? { note: "minted sUSD to the buyer so it can pay the hires", txHash: funding.minted, explorerUrl: `${EXPLORER}/tx/${funding.minted}` }
  : { note: "buyer already held enough sUSD", txHash: null, explorerUrl: null };

for (const item of PLAN) {
  const record = {
    agent: item.name,
    tokenId: item.tokenId,
    category: item.category,
    registryEndpoint: item.registryEndpoint,
    messagingUrl: item.messagingUrl,
    task: item.task,
  };
  try {
    const pr = await requirements(item.tokenId);
    record.agentWallet = getAddress(pr.payTo);
    record.tokenSymbol = pr.extra?.name ?? null;
    const signed = await signAuthorization(pr);

    const api = await settleViaApi(pr, signed, item.tokenId, item.name);
    if (api.ok) {
      record.settlement = { source: "marketplace-api", mode: api.mode, txHash: api.txHash, explorerUrl: `${EXPLORER}/tx/${api.txHash}`, paymentId: api.paymentId };
    } else {
      // the API did not relay a real tx (sandbox or error), settle directly on chain
      const hash = await settleDirect(pr, signed);
      record.settlement = {
        source: "direct-onchain-eip3009",
        mode: "onchain",
        txHash: hash,
        explorerUrl: `${EXPLORER}/tx/${hash}`,
        paymentId: api.paymentId,
        apiAttempt: { mode: api.mode, error: api.body?.error ?? null },
      };
    }

    const delivery = await deliverA2a(item.messagingUrl, item.task, item.data);
    const deliverable = extractDeliverable(delivery.body ?? delivery.raw);
    const scored = scoreDelivery(deliverable);
    record.delivery = {
      httpStatus: delivery.httpStatus,
      isJsonRpcError: Boolean(delivery.body?.error),
      jsonRpcError: delivery.body?.error?.message ?? null,
      deliverable,
      delivered: scored.grade !== "poor",
      note: item.note ?? null,
    };
    record.quality = scored;
    console.log(`${item.category.padEnd(14)} ${item.name.padEnd(12)} tx ${record.settlement.txHash}  grade ${scored.grade} (${scored.score})`);
  } catch (e) {
    record.error = e.message;
    record.settlement = null;
    record.delivery = { delivered: false, deliverable: "", note: "no hire completed" };
    record.quality = { score: 0, grade: "poor", reason: e.message };
    console.log(`${item.category.padEnd(14)} ${item.name.padEnd(12)} FAILED ${e.message}`);
  }
  results[item.category] = record;
}

const capturedAt = new Date().toISOString();
const out = {
  capturedAt,
  chainId: CHAIN_ID,
  marketplaceApi: API,
  buyer: buyer.address,
  disclosure:
    "Team verification activity on our own keys. This is the Agent Souk delivery sweep already disclosed as team activity in the tracking document. Volume is deliberately limited to one hire per category.",
  funding: fundingNote,
  categories: results,
  gridTradingNote:
    "No chain-97 grid-trading agent returns a grid deliverable over A2A. Grid Runner (2173) exposes only negotiate and notify_funded; Hevo Grid (2018) and LingoAI Grid Trading (1853) return only an ERC-8183 price quote and gate the actual work behind their own escrow.",
};
writeFileSync(new URL("./chain97-category-hires.json", import.meta.url), JSON.stringify(out, null, 2) + "\n", "utf8");

// the flagship single hire, for the stand-alone evidence file
const flagship = results["yield"];
const realHire = {
  capturedAt,
  chainId: CHAIN_ID,
  marketplaceApi: API,
  disclosure: out.disclosure,
  agent: flagship.agent,
  tokenId: flagship.tokenId,
  category: flagship.category,
  agentWallet: flagship.agentWallet,
  settlement: flagship.settlement,
  task: flagship.task,
  deliverable: flagship.delivery?.deliverable ?? "",
  delivered: flagship.delivery?.delivered ?? false,
  quality: flagship.quality,
};
writeFileSync(new URL("./chain97-real-hire.json", import.meta.url), JSON.stringify(realHire, null, 2) + "\n", "utf8");

console.log("\nwrote scripts/chain97-category-hires.json and scripts/chain97-real-hire.json");
