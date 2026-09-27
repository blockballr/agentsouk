// Manual side of the agent-vs-manual comparison. Shared by
// scripts/run-advantage-tasks.mjs and scripts/build-advantage-from-hires.mjs so
// both captures measure the same hand-run implementation. Each function hits
// public sources live; the caller times it with Date.now() around the call.
import { encodeFunctionData, decodeFunctionResult } from "viem";

export const JSON_HEADERS = { "Content-Type": "application/json" };
export const MANUAL_RATE_USD_PER_H = 50;

export const BSC_RPCS = [
  "https://bsc-dataseed.binance.org",
  "https://1rpc.io/bnb",
  "https://bsc.publicnode.com",
  "https://bsc-dataseed1.defiwallet.vm.binance.org",
];

export async function fetchJson(url, opts = {}, timeoutMs = 90000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = { _nonJson: raw.slice(0, 500) };
  }
  return { status: res.status, body };
}

async function ethCall(rpc, to, data) {
  const res = await fetchJson(rpc, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  }, 30000);
  if (res.body?.error) throw new Error(JSON.stringify(res.body.error).slice(0, 200));
  const result = res.body?.result;
  if (!result || result === "0x") throw new Error("empty eth_call result");
  return result;
}

async function readContract(rpcList, address, abi, fn, args = []) {
  const data = encodeFunctionData({ abi, functionName: fn, args });
  let lastErr;
  for (const rpc of rpcList) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await ethCall(rpc, address, data);
        return { rpc, value: decodeFunctionResult({ abi, functionName: fn, args, data: raw }) };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

const V_TOKEN_ABI = [
  { name: "comptroller", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "exchangeRateStored", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getAccountSnapshot", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "getCash", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalBorrows", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

const COMPTROLLER_ABI = [
  { name: "markets", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }, { type: "uint256" }, { type: "bool" }] },
  { name: "closeFactorMantissa", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getAccountLiquidity", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
  { name: "oracle", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

const ORACLE_ABI = [
  { name: "getUnderlyingPrice", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

const ERC20_ABI = [
  { name: "underlying", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];

const V_TOKENS = {
  vBNB: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
  vUSDT: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
  vUSDC: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
  vETH: "0xf508fCD89b8bd15579dc79A6827cB4686A3592c8",
  vBTC: "0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B",
};

export async function manualHealthFactor() {
  const t0 = Date.now();
  const lines = [];
  const account = "0xa09991fc5D8637bb4245737C3ebF26E24D653962";
  try {
    const vbnbSym = await readContract(BSC_RPCS, V_TOKENS.vBNB, V_TOKEN_ABI, "symbol");
    if (vbnbSym.value !== "vBNB") throw new Error(`expected vBNB symbol, got ${vbnbSym.value}`);
    lines.push(`rpc used: ${vbnbSym.rpc}`);
    const comptrollerAddr = (await readContract(BSC_RPCS, V_TOKENS.vBNB, V_TOKEN_ABI, "comptroller")).value;
    lines.push(`venus core comptroller (diamond): ${comptrollerAddr}`);
    const oracleAddr = (await readContract(BSC_RPCS, comptrollerAddr, COMPTROLLER_ABI, "oracle")).value;
    lines.push(`venus oracle: ${oracleAddr}`);

    const marketStats = [];
    for (const [sym, addr] of Object.entries(V_TOKENS)) {
      const actualSym = (await readContract(BSC_RPCS, addr, V_TOKEN_ABI, "symbol")).value;
      if (actualSym !== sym) throw new Error(`expected ${sym}, got ${actualSym} at ${addr}`);
      const rate = (await readContract(BSC_RPCS, addr, V_TOKEN_ABI, "exchangeRateStored")).value;
      let underlyingAddr;
      let dec;
      if (sym === "vBNB") {
        underlyingAddr = "native BNB";
        dec = 18;
      } else {
        underlyingAddr = (await readContract(BSC_RPCS, addr, ERC20_ABI, "underlying")).value;
        dec = Number((await readContract(BSC_RPCS, underlyingAddr, ERC20_ABI, "decimals")).value);
      }
      const cash = (await readContract(BSC_RPCS, addr, V_TOKEN_ABI, "getCash")).value;
      const borrows = (await readContract(BSC_RPCS, addr, V_TOKEN_ABI, "totalBorrows")).value;
      const priceRaw = (await readContract(BSC_RPCS, oracleAddr, ORACLE_ABI, "getUnderlyingPrice", [addr])).value;
      const cashUnder = Number(cash) / Math.pow(10, dec);
      const borrowUnder = Number(borrows) / Math.pow(10, dec);
      const priceUsd = Number(priceRaw) / 1e18;
      const tvlUsd = (cashUnder + borrowUnder) * priceUsd;
      marketStats.push({ sym, addr, rate, dec, tvlUsd });
      lines.push(`${sym}: cash=${cashUnder.toFixed(6)} borrows=${borrowUnder.toFixed(6)} underlying=${underlyingAddr} (${dec} dec) oraclePrice=$${priceUsd.toFixed(2)} TVL=$${tvlUsd.toFixed(2)} exchangeRate=${rate.toString()}`);
    }
    marketStats.sort((a, b) => b.tvlUsd - a.tvlUsd);
    const largest = marketStats[0];
    lines.push(`largest real Venus Core market of the five probed (computed from the live reads above): ${largest.sym} at $${largest.tvlUsd.toFixed(2)} TVL. Note: the Venus Core pool is in wind-down, so these TVLs are small by historical standards.`);

    const markets = (await readContract(BSC_RPCS, comptrollerAddr, COMPTROLLER_ABI, "markets", [largest.addr])).value;
    const collateralFactor = Number(markets[1]) / 1e18;
    lines.push(`${largest.sym} listed=${markets[0]} collateralFactor=${collateralFactor} isComped=${markets[2]}`);
    const closeFactor = (await readContract(BSC_RPCS, comptrollerAddr, COMPTROLLER_ABI, "closeFactorMantissa")).value;
    lines.push(`comptroller closeFactorMantissa: ${closeFactor.toString()} (${(Number(closeFactor) / 1e18).toFixed(4)} of debt repayable per liquidation)`);

    let funded = false;
    for (const m of marketStats) {
      try {
        const snap = (await readContract(BSC_RPCS, m.addr, V_TOKEN_ABI, "getAccountSnapshot", [account])).value;
        const tokenBalance = snap[1];
        const borrowBalance = snap[2];
        const snapRate = snap[3];
        const underlyingAmount = (Number(tokenBalance) * Number(snapRate)) / Math.pow(10, 18 + m.dec);
        lines.push(`${m.sym} getAccountSnapshot(${account}): tokenBalance=${tokenBalance.toString()} (=${underlyingAmount.toFixed(8)} underlying at exchangeRate ${snapRate.toString()}) borrowBalance(raw)=${borrowBalance.toString()}`);
        if (tokenBalance !== 0n || borrowBalance !== 0n) funded = true;
      } catch (e) {
        lines.push(`${m.sym} snapshot unavailable: ${e.message}`);
      }
    }
    const liq = (await readContract(BSC_RPCS, comptrollerAddr, COMPTROLLER_ABI, "getAccountLiquidity", [account])).value;
    lines.push(`comptroller.getAccountLiquidity(${account}): err=${liq[0].toString()} liquidity=${liq[1].toString()} shortfall=${liq[2].toString()}`);
    if (liq[1] !== 0n || liq[2] !== 0n) funded = true;

    if (!funded) {
      lines.push(`NO FUNDED VENUS POSITION FOUND at probed account ${account}: all probed vToken balances and borrows are zero and account liquidity is flat.`);
      lines.push(`ASSESSING MARKET PARAMETERS, NOT A LIVE POSITION: the parameters above are for ${largest.sym}, the largest real Venus Core market of the five probed.`);
      const exampleSupply = 1;
      const exampleDebt = 0.3;
      const exampleHf = (exampleSupply * collateralFactor) / exampleDebt;
      lines.push(`HF formula: HF = (collateral value * collateralFactor) / debt value. Worked example on the real ${largest.sym} parameters above: supply 1 unit of collateral, borrow 0.3 units -> HF = (1 * ${collateralFactor}) / 0.3 = ${exampleHf.toFixed(4)}. Close factor ${(Number(closeFactor) / 1e18).toFixed(4)} limits liquidation repayment per pass.`);
    } else {
      const liquidityUsd = Number(liq[1]) / 1e18;
      const shortfallUsd = Number(liq[2]) / 1e18;
      const hf = shortfallUsd > 0 ? 0 : liquidityUsd > 0 ? Number.POSITIVE_INFINITY : null;
      lines.push(`LIVE POSITION FOUND: comptroller liquidity=$${liquidityUsd.toFixed(2)} shortfall=$${shortfallUsd.toFixed(2)} -> HF ${hf === null ? "undefined" : hf === Number.POSITIVE_INFINITY ? "infinite (no debt against collateral)" : hf.toFixed(4)}; HF = (collateral value * collateralFactor) / debt value, equivalent to the comptroller's liquidity/shortfall read above.`);
    }
    return { seconds: (Date.now() - t0) / 1000, output: lines.join("\n"), error: false };
  } catch (e) {
    lines.push(`manual on-chain pass failed: ${e.message}`);
    return { seconds: (Date.now() - t0) / 1000, output: lines.join("\n"), error: true };
  }
}

export async function manualYield() {
  const t0 = Date.now();
  const lines = [];
  try {
    const res = await fetchJson("https://yields.llama.fi/pools", {}, 120000);
    const pools = res.body?.data;
    if (!Array.isArray(pools)) throw new Error(`DefiLlama yields API returned no pool array: ${JSON.stringify(res.body).slice(0, 200)}`);
    const bscStable = pools
      .filter((p) => p.chain === "BSC" && p.stablecoin === true && p.tvlUsd >= 1_000_000 && p.apy != null)
      .sort((a, b) => b.apy - a.apy);
    lines.push(`source: https://yields.llama.fi/pools (DefiLlama public API), captured live; ${bscStable.length} BSC stablecoin pools with TVL >= 1,000,000 USD`);
    const seen = new Set();
    const top = [];
    for (const p of bscStable) {
      const key = `${p.project}|${p.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      top.push(p);
      if (top.length === 5) break;
    }
    lines.push("top BSC stablecoin pools by APY (live):");
    lines.push("rank | project | pool | APY % | TVL USD");
    top.forEach((p, i) => {
      lines.push(`${i + 1} | ${p.project} | ${p.symbol} | ${p.apy.toFixed(2)} | ${Math.round(p.tvlUsd).toLocaleString("en-US")}`);
    });
    const weights = [0.3, 0.25, 0.2, 0.15, 0.1];
    lines.push("proposed allocation (max 30% per venue, stablecoin-only, TVL floor 1M USD as risk parameters):");
    top.forEach((p, i) => {
      lines.push(`${weights[i] * 100}% -> ${p.project} ${p.symbol} (${p.apy.toFixed(2)}% APY)`);
    });
    const blended = top.reduce((acc, p, i) => acc + (p.apy * weights[i]), 0);
    lines.push(`blended APY at proposed weights: ${blended.toFixed(2)}%`);
    return { seconds: (Date.now() - t0) / 1000, output: lines.join("\n"), error: false };
  } catch (e) {
    lines.push(`manual yield pass failed: ${e.message}`);
    return { seconds: (Date.now() - t0) / 1000, output: lines.join("\n"), error: true };
  }
}

export async function manualGrid() {
  const t0 = Date.now();
  const lines = [];
  try {
    let kl;
    for (const host of ["https://api.binance.com", "https://data-api.binance.vision"]) {
      const res = await fetchJson(`${host}/api/v3/klines?symbol=BNBUSDT&interval=1d&limit=30`, {}, 30000);
      if (Array.isArray(res.body)) {
        kl = res.body;
        lines.push(`source: ${host}/api/v3/klines BNBUSDT 1d x30, captured live`);
        break;
      }
    }
    if (!kl) throw new Error("no klines source answered");
    const closes = kl.map((k) => Number(k[4]));
    const highs = kl.map((k) => Number(k[2]));
    const lows = kl.map((k) => Number(k[3]));
    const lastClose = closes[closes.length - 1];
    const logRets = [];
    for (let i = 1; i < closes.length; i++) logRets.push(Math.log(closes[i] / closes[i - 1]));
    const mean = logRets.reduce((a, b) => a + b, 0) / logRets.length;
    const variance = logRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (logRets.length - 1);
    const sigmaDaily = Math.sqrt(variance);
    const sigma30 = sigmaDaily * Math.sqrt(30);
    const lower = lastClose * (1 - 1.28 * sigma30);
    const upper = lastClose * (1 + 1.28 * sigma30);
    const levels = 8;
    const spacingPct = ((upper - lower) / (levels - 1) / lastClose) * 100;
    lines.push(`last close: ${lastClose} USDT; 30d observed range: ${Math.min(...lows)} - ${Math.max(...highs)}`);
    lines.push(`daily log-return stdev: ${sigmaDaily.toFixed(6)} (${(sigmaDaily * 100).toFixed(2)}%/day); 30d scaled sigma: ${(sigma30 * 100).toFixed(2)}%`);
    lines.push(`grid bounds (last close +- 1.28 * sigma30, ~80% band): lower=${lower.toFixed(2)} upper=${upper.toFixed(2)}`);
    lines.push(`levels: ${levels} evenly spaced`);
    lines.push(`spacing between levels: ${spacingPct.toFixed(3)}% of price per level`);
    lines.push(`risk parameters: taker fee 0.1% per side (0.2% per completed grid trade); profit per completed grid trade = ${(spacingPct - 0.2).toFixed(3)}% before slippage; stop if price closes outside [${lower.toFixed(2)}, ${upper.toFixed(2)}]`);
    return { seconds: (Date.now() - t0) / 1000, output: lines.join("\n"), error: false };
  } catch (e) {
    lines.push(`manual grid pass failed: ${e.message}`);
    return { seconds: (Date.now() - t0) / 1000, output: lines.join("\n"), error: true };
  }
}
