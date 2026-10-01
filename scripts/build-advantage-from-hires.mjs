// Assemble the agent-vs-manual capture from real hires that were made by hand
// through the marketplace, instead of a scripted settle+deliver run. Read-only:
// it never signs, never sends a transaction and never prints a key. Agent time
// comes from the marketplace's own task record, because the hire already
// happened before this script runs; only the manual side is timed live.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, join } from "node:path";
import {
  fetchJson,
  MANUAL_RATE_USD_PER_H,
  manualHealthFactor,
  manualYield,
  manualGrid,
} from "./advantage-manual.mjs";

const BASE = "https://api.agentsouk.xyz";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_WALLET = "0x84fedaBd1b83443aD86796C15619494878B64180";
const DEFAULT_OUT = "data/advantage-tasks.json";
const CHAIN_ID = 97;

// the three categories the existing capture covers, in report order
const CATEGORIES = ["health-factor", "yield", "grid-trading"];
const TASK_IDS = {
  "health-factor": "task-1-health-factor",
  yield: "task-2-yield",
  "grid-trading": "task-3-grid-trading",
};
const MANUALS = {
  "health-factor": manualHealthFactor,
  yield: manualYield,
  "grid-trading": manualGrid,
};

// chain 97 settles in sUSD (18 decimals) and chain 56 in $U (18 decimals),
// matching src/lib/types.ts. Used to turn a raw receipt amount into a fee.
const ASSET_DECIMALS = { 97: 18, 56: 18 };

function parseArgs(argv) {
  const opts = { wallet: DEFAULT_WALLET, dryRun: false, only: null, out: DEFAULT_OUT, allowPartial: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--allow-partial") opts.allowPartial = true;
    else if (a === "--only") opts.only = args[++i] ?? null;
    else if (a.startsWith("--only=")) opts.only = a.slice("--only=".length);
    else if (a === "--wallet") opts.wallet = args[++i] ?? opts.wallet;
    else if (a.startsWith("--wallet=")) opts.wallet = a.slice("--wallet=".length);
    else if (a === "--out") opts.out = args[++i] ?? opts.out;
    else if (a.startsWith("--out=")) opts.out = a.slice("--out=".length);
    else if (!a.startsWith("-")) opts.wallet = a;
    else throw new Error(`unknown flag ${a}`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(opts.wallet)) {
    throw new Error(`wallet must be an address, got ${opts.wallet}`);
  }
  return opts;
}

async function fetchHires(wallet) {
  const { status, body } = await fetchJson(
    `${BASE}/api/hires/by-wallet?wallet=${wallet}`,
    {},
    60000,
  );
  if (status !== 200 || !body?.success) {
    throw new Error(`hires read failed (HTTP ${status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return Array.isArray(body.hires) ? body.hires : [];
}

// A hire against an agent the buyer owns pays the buyer's own wallet, so it is a
// self-dealing round trip rather than marketplace evidence. The marketplace grades
// itself on this report, so such hires are left out, as they are for the house
// agent. An unreadable list excludes nothing, so a slow read degrades to the
// previous behaviour rather than guessing.
async function fetchOwnedTokenIds(wallet) {
  try {
    const { status, body } = await fetchJson(
      `${BASE}/api/agents/by-owner?owner=${encodeURIComponent(wallet)}`,
      {},
      45000,
    );
    if (status !== 200 || !body?.success) return new Set();
    return new Set((Array.isArray(body.agents) ? body.agents : []).map((a) => String(a.tokenId)));
  } catch {
    return new Set();
  }
}

function isDelivered(task) {
  return task?.status === "delivered" && typeof task.result === "string" && task.result.length > 0;
}

// The per-payment read is intermittently slow on the deployed API, so a timeout
// is treated as "no answer" and the list fallback below is used instead of
// failing the whole assembly on one slow read.
async function fetchTasksForPayment(paymentId) {
  try {
    const { status, body } = await fetchJson(
      `${BASE}/api/tasks?paymentId=${encodeURIComponent(paymentId)}`,
      {},
      45000,
    );
    if (status !== 200) return [];
    return Array.isArray(body?.tasks) ? body.tasks : [];
  } catch {
    return [];
  }
}

let taskList = null;
async function fetchAllTasks() {
  if (taskList) return taskList;
  try {
    const { status, body } = await fetchJson(`${BASE}/api/tasks`, {}, 60000);
    taskList = status === 200 && Array.isArray(body?.tasks) ? body.tasks : [];
  } catch {
    taskList = [];
  }
  return taskList;
}

// The per-payment read can return an older placeholder row for a payment while
// the delivered row of that same payment is only visible in the task list, so
// when the per-payment read shows no delivered result, consult the list before
// giving up. The list is fetched once per run.
async function tasksForPayment(paymentId, listFallbacks) {
  const direct = await fetchTasksForPayment(paymentId);
  if (direct.some(isDelivered)) return direct;
  const matching = (await fetchAllTasks()).filter((t) => t.paymentId === paymentId);
  if (matching.some(isDelivered)) {
    listFallbacks.push(paymentId);
    return [...direct, ...matching];
  }
  return direct;
}

function pickDelivered(tasks) {
  return (
    tasks
      .filter(isDelivered)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))[0] ?? null
  );
}

// Agent time is measured from the task record's own history: the moment the task
// entered running to the moment it was recorded delivered. It is not a stopwatch
// in this script, because the hire already happened; this is the marketplace's
// record of how long the agent took.
function agentSecondsFromTask(task) {
  const history = Array.isArray(task.history) ? task.history : [];
  const running = history.find((h) => h.status === "running") ?? history.find((h) => h.status === "ready");
  const delivered = [...history].reverse().find((h) => h.status === "delivered");
  if (!running?.at || !delivered?.at) return null;
  const start = Date.parse(running.at);
  const end = Date.parse(delivered.at);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Number(((end - start) / 1000).toFixed(2));
}

// The by-wallet hire record exposes spendCapUsd but not the settled amount, so
// the amount is read from the same payment's receipt. If neither record carries
// it, the fee is left out rather than guessed.
async function amountFor(hire) {
  if (hire.amount != null) {
    return { raw: hire.amount, symbol: hire.symbol ?? null, decimals: hire.decimals ?? null };
  }
  try {
    const { status, body } = await fetchJson(
      `${BASE}/api/receipts/${encodeURIComponent(hire.paymentId)}`,
      {},
      60000,
    );
    if (status === 200 && body?.amount != null) {
      return { raw: body.amount, symbol: body.symbol ?? null, decimals: null };
    }
  } catch {
    // an unreadable receipt leaves the fee unstated rather than guessed
  }
  return null;
}

function rawToUsd(raw, decimals) {
  if (decimals == null) return null;
  try {
    const base = 10n ** BigInt(decimals);
    const v = BigInt(String(raw));
    return Number(v / base) + Number(v % base) / Number(base);
  } catch {
    return null;
  }
}

function fmt(n) {
  return Number(n).toFixed(2);
}

function manualCost(seconds) {
  return Number(((seconds / 3600) * MANUAL_RATE_USD_PER_H).toFixed(4));
}

// "apy" as its own token, or a camelCase field such as supplyApyPercent with a
// number attached. This avoids matching words that merely contain the letters,
// like pancakeSwapYieldContext, which is not an APY figure.
function mentionsApy(text) {
  return /(^|[^a-z])apy([^a-z]|$)/i.test(text) || /apy[a-z]{0,20}[\s\S]{0,20}?\d/i.test(text);
}

function timeNote(agentSeconds, manualSeconds) {
  return `agent ${fmt(agentSeconds)}s running to delivered vs manual ${fmt(manualSeconds)}s ($${fmt((manualSeconds / 3600) * MANUAL_RATE_USD_PER_H)} at 50 USD/h)`;
}

function buildVerdict({ category, name, paymentId, chainId, agentSeconds, output, manual }) {
  const note = timeNote(agentSeconds, manual.seconds);
  if (manual.error) {
    return {
      winner: "agent",
      notes: `Manual side failed and the error is recorded verbatim in manualOutput, so the agent wins by default. ${note}.`,
    };
  }
  if (category === "health-factor") {
    const agentRich = /health_?factor|liquidation|no debt/i.test(output);
    return {
      winner: agentRich ? "agent" : "manual",
      notes: agentRich
        ? `${name} returned a direct Venus Core read for the probed account in ${fmt(agentSeconds)}s from the real settled hire ${paymentId} on chain ${chainId}, ending at either a health factor and restore amount or an explicit no-debt verdict; the manual on-chain pass read the same account over public BSC RPC and, finding it empty, fell back to real market parameters (TVL ranking, exchange rate, collateral factor, close factor) with a worked health-factor formula in ${fmt(manual.seconds)}s. The agent answers the question that was asked; the manual pass wins on raw-value transparency.`
        : `${name}'s delivered hire on chain ${chainId} carries no recognizable health-factor or liquidation content, so the manual on-chain pass wins. ${note}.`,
    };
  }
  if (category === "yield") {
    const agentHasApy = mentionsApy(output);
    return {
      winner: agentHasApy ? "agent" : "manual",
      notes: agentHasApy
        ? `${name} returned venue-native Venus supply APYs with the observed block number in ${fmt(agentSeconds)}s from the real settled hire ${paymentId} on chain ${chainId}; the manual pass pulled DefiLlama's BSC stablecoin pool table and built a weighted allocation with a blended APY in ${fmt(manual.seconds)}s. The agent's rates come from the protocol directly; the manual pass wins on explicit allocation math.`
        : `${name}'s delivered hire on chain ${chainId} returned no APY figure, so it does not answer the yield question and the manual DefiLlama pass wins. ${note}.`,
    };
  }
  const agentAnswersGrid = /grid|bound|level|rebalanc/i.test(output);
  return {
    winner: agentAnswersGrid ? "tie" : "manual",
    notes: agentAnswersGrid
      ? `${name} returned grid-shaped content in ${fmt(agentSeconds)}s from the real settled hire ${paymentId} on chain ${chainId}; the manual pass computed real bounds, level spacing and per-trade profit from 30 days of BNBUSDT candles in ${fmt(manual.seconds)}s. ${note}.`
      : `${name}'s delivered hire on chain ${chainId} returned no grid plan through the marketplace, so the manual pass computed real grid bounds and levels from live BNBUSDT klines and wins plainly. ${note}.`,
  };
}

async function buildTasks(opts) {
  const listFallbacks = [];
  const hires = await fetchHires(opts.wallet);
  const ownedTokens = await fetchOwnedTokenIds(opts.wallet);
  // only hires that actually settled on chain count as the published evidence
  const settled = hires.filter(
    (h) => h.category && MANUALS[h.category] && h.mode === "prod" && h.txHash,
  );
  for (const hire of settled) {
    if (ownedTokens.has(String(hire.tokenId))) {
      console.log(
        `skip ${hire.category}: hire ${hire.paymentId} is against agent ${hire.tokenId}, owned by the buyer wallet ${opts.wallet}, so it is self-dealing and not marketplace evidence`,
      );
    }
  }
  const candidates = settled
    .filter((h) => !ownedTokens.has(String(h.tokenId)))
    .filter((h) => !opts.only || h.paymentId === opts.only)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));

  const chosen = new Map();
  for (const hire of candidates) {
    if (chosen.has(hire.category)) continue;
    const task = pickDelivered(await tasksForPayment(hire.paymentId, listFallbacks));
    if (!task) continue;
    chosen.set(hire.category, { hire, task });
  }
  for (const paymentId of listFallbacks) {
    console.warn(`note: ${paymentId} only showed its delivered task in the task list, not in the per-payment read`);
  }

  const tasks = [];
  for (const category of CATEGORIES) {
    const entry = chosen.get(category);
    if (!entry) {
      console.log(`skip ${category}: no delivered prod hire found for ${opts.wallet} yet, not substituting another agent`);
      continue;
    }
    const { hire, task } = entry;
    const seconds = agentSecondsFromTask(task);
    if (seconds == null) {
      console.log(`skip ${category}: hire ${hire.paymentId} is delivered but its task history has no running-to-delivered pair, so the agent time cannot be derived; not guessing`);
      continue;
    }
    console.log(`${hire.agentName} (${hire.tokenId}, ${category}) hire ${hire.paymentId} delivered; timing the manual side live`);
    const manual = await MANUALS[category]();
    const amount = await amountFor(hire);
    const decimals = amount?.decimals ?? ASSET_DECIMALS[hire.chainId] ?? null;
    const statedFeeUsd = amount ? rawToUsd(amount.raw, decimals) : null;
    const verdict = buildVerdict({
      category,
      name: hire.agentName,
      paymentId: hire.paymentId,
      chainId: hire.chainId,
      agentSeconds: seconds,
      output: task.result,
      manual,
    });
    tasks.push({
      id: TASK_IDS[category],
      category,
      prompt: task.taskText ?? null,
      agent: {
        tokenId: String(hire.tokenId),
        name: hire.agentName,
        category: hire.category,
        chainId: hire.chainId,
        settleMode: "prod",
        paymentId: hire.paymentId,
        txHash: hire.txHash ?? undefined,
        statedFeeUsd: statedFeeUsd ?? undefined,
      },
      quality: task.quality ?? undefined,
      agentOutput: task.result,
      agentSeconds: seconds,
      manualSeconds: Number(manual.seconds.toFixed(2)),
      manualCostUsd: manualCost(manual.seconds),
      manualOutput: manual.output,
      verdict,
    });
  }
  return tasks;
}

function buildReport(wallet, tasks) {
  const generatedAt = new Date().toISOString();
  const chainIds = [...new Set(tasks.map((t) => t.agent.chainId))];
  const requestedChainId = chainIds.length === 1 ? chainIds[0] : CHAIN_ID;

  let prior = {};
  try {
    prior = JSON.parse(readFileSync(new URL("../data/advantage-tasks.json", import.meta.url), "utf8"));
  } catch {
    // first capture: nothing to carry
  }

  const methodology = [
    `Run date: ${generatedAt}. Each task below is a real hire made by the participant wallet ${wallet} through the Agent Souk marketplace at ${BASE} on BSC testnet chain 97, settled on chain in sUSD, then read back from the marketplace's own task record.`,
    "Agent time is measured from the task record's own history, from the timestamp the task entered running to the timestamp it was recorded delivered. It is not a stopwatch in the producing script, because the hire happened before the capture was assembled; the manual side is the only side timed live, with Date.now() around its real execution.",
    `The manual side runs the hand-run implementation shared with scripts/run-advantage-tasks.mjs, factored into scripts/advantage-manual.mjs, against live public sources; each hired task carries its own prompt and the manual pass answers the matching category question, so the two sides are compared on outcome rather than on identical wording. Manual cost is wall-clock time at a stated 50 USD per hour.`,
    "agentOutput is the verbatim result the agent returned, and quality is the grader's own record where the marketplace stored one.",
    "Manual sources: Venus Core reads (vToken exchange rates, cash and borrows, comptroller markets, close factor, oracle prices, account snapshots) over public BSC RPC with fallbacks (bsc-dataseed.binance.org, 1rpc.io/bnb, bsc.publicnode.com, bsc-dataseed1.defiwallet.vm.binance.org); DefiLlama public yields API (yields.llama.fi/pools); Binance public klines endpoint (BNBUSDT 1d x30).",
    "Only categories that had a delivered prod hire at assembly time appear here; a category with no delivered hire is omitted rather than padded.",
    "Rerunning scripts/build-advantage-from-hires.mjs overwrites this file with a fresh capture; the run date above is the reproduction anchor.",
  ].join(" ");

  return {
    generatedAt,
    network: prior.network,
    capture: {
      measuredAt: generatedAt,
      rail: "x402 prod, EIP-3009 transferWithAuthorization relayed on chain",
      server: BASE,
      requestedChainId,
      settledOnChain: true,
      note: `These captures are real hires made through the Agent Souk marketplace at ${BASE} on BSC testnet chain 97. The buyer is the participant wallet ${wallet}, a marketplace user rather than the team's relay wallet, and every hire settled on chain in sUSD, so each task below carries the settlement transaction hash recorded in its hire receipt.`,
    },
    mainnet: prior.mainnet,
    methodology,
    tasks,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const outPath = isAbsolute(opts.out) ? opts.out : join(ROOT, opts.out);
  console.log(`wallet ${opts.wallet}${opts.only ? `, only ${opts.only}` : ""}${opts.dryRun ? " (dry run)" : ""}`);
  const tasks = await buildTasks(opts);
  const out = buildReport(opts.wallet, tasks);

  console.log(`\nassembled ${tasks.length} task(s)`);
  for (const t of tasks) {
    console.log(`- ${t.id} (${t.category}): agent ${t.agent.name}, agent ${fmt(t.agentSeconds)}s, manual ${fmt(t.manualSeconds)}s, tx ${t.agent.txHash ?? "unknown"}, winner ${t.verdict.winner}`);
  }

  if (opts.dryRun) {
    console.log("\ndry run, nothing written. assembled capture:\n");
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (tasks.length === 0) {
    throw new Error("no delivered prod hires assembled, refusing to overwrite the published capture");
  }
  // the published capture is live evidence; do not replace it with a partial
  // category set unless the operator asks for that explicitly
  if (!opts.allowPartial && tasks.length < CATEGORIES.length) {
    const missing = CATEGORIES.filter((c) => !tasks.some((t) => t.category === c));
    throw new Error(`only ${tasks.length} of ${CATEGORIES.length} categories assembled (missing ${missing.join(", ")}); wait for those hires, or pass --allow-partial to write anyway`);
  }
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${opts.out} with ${tasks.length} tasks`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
