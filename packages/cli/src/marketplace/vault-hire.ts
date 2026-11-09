import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { CliError } from "../core/errors";
import { apiRequest, query } from "../core/http";
import type { CliConfig } from "../core/config";
import type { LoadedSigner } from "../core/wallet";
import { showAgent } from "./agents";

// The buyer's side of a HireVault hire: the deposit sits in the vault contract,
// the agent trades inside the caps the contract stores at open, and withdraw is
// the only way the money leaves. The CLI never holds anything.

const FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const FEE_TIERS = [100, 500, 2500, 10000] as const;
const MAX_SLIPPAGE_BPS = 1000;
const MAX_TERM_DAYS = 90;

interface VaultToken {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
}

const TOKENS: Record<number, { A: VaultToken; B: VaultToken }> = {
  56: {
    A: { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
    B: { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  },
  97: {
    A: { symbol: "WBNB", address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", decimals: 18 },
    B: { symbol: "USDT", address: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", decimals: 18 },
  },
};

const VAULT_ABI = [
  {
    name: "open",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "maxSlippageBps", type: "uint16" },
      { name: "fee", type: "uint24" },
      { name: "agentFeeBps", type: "uint16" },
      { name: "maxLossBps", type: "uint16" },
      { name: "venue", type: "address" },
    ],
    outputs: [],
  },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { name: "hiresOf", type: "function", stateMutability: "view", inputs: [{ name: "buyer", type: "address" }], outputs: [{ type: "uint256[]" }] },
  { name: "capA", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "capB", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "minDepositInToken0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "MAX_OPEN_PER_BUYER", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "valueInToken0", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
  {
    name: "hire",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "agent", type: "address" },
      { name: "expiry", type: "uint64" },
      { name: "maxSlippageBps", type: "uint16" },
      { name: "open", type: "bool" },
      { name: "balanceA", type: "uint256" },
      { name: "balanceB", type: "uint256" },
      { name: "refPriceX96", type: "uint160" },
      { name: "fee", type: "uint24" },
      { name: "depositInToken0", type: "uint256" },
      { name: "deployedB", type: "uint256" },
      { name: "agentFeeBps", type: "uint16" },
      { name: "highWaterMark", type: "uint256" },
      { name: "maxLossBps", type: "uint16" },
      { name: "venue", type: "address" },
    ],
  },
] as const;

const TOKEN_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const WRAP_ABI = [{ name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] }] as const;
const FACTORY_ABI = [
  { name: "getPool", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }, { name: "b", type: "address" }, { name: "fee", type: "uint24" }], outputs: [{ type: "address" }] },
] as const;
const POOL_ABI = [
  { name: "liquidity", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint32" },
      { name: "unlocked", type: "bool" },
    ],
  },
  { name: "observe", type: "function", stateMutability: "view", inputs: [{ name: "secondsAgos", type: "uint32[]" }], outputs: [{ type: "int56[]" }, { type: "uint160[]" }] },
] as const;

export interface FeeChoice {
  fee: number;
  pool: `0x${string}`;
  liquidity: bigint;
  twapOk: boolean;
  price: number | null;
}

export interface VaultHireOptions {
  deposit: string;
  token?: string;
  days?: string;
  slippage?: string;
  fee?: string;
  agentFee?: string;
  maxLoss?: string;
  venue?: string;
}

export interface VaultHirePlan {
  chainId: number;
  tokenId: string;
  agentName: string;
  agentWallet: `0x${string}`;
  vault: `0x${string}`;
  client: `0x${string}`;
  token: VaultToken;
  amount: bigint;
  amountText: string;
  expiry: number;
  expiryIso: string;
  slippageBps: number;
  fee: number;
  feeLabel: string;
  pool: `0x${string}`;
  agentFeeBps: number;
  maxLossBps: number;
  venue: `0x${string}`;
  capText: string;
  floorText: string | null;
  openCount: number;
  maxOpen: number | null;
  allowance: bigint;
  needsApprove: boolean;
  wrapWei: bigint;
  bnbBalance: bigint;
  gas: { wrap: bigint | null; approve: bigint | null; open: bigint; gasPrice: bigint };
}

function chainFor(chainId: number) {
  return chainId === 97 ? bscTestnet : bsc;
}

function publicClient(config: CliConfig) {
  return createPublicClient({ chain: chainFor(config.chainId), transport: http(config.rpcUrl, { timeout: 20_000 }) });
}

function walletClient(config: CliConfig, signer: LoadedSigner) {
  return createWalletClient({ account: signer.account, chain: chainFor(config.chainId), transport: http(config.rpcUrl, { timeout: 20_000 }) });
}

export function tokenFor(chainId: number, choice: string | undefined): VaultToken {
  const pair = TOKENS[chainId];
  if (!pair) throw new CliError(`no vault token pair is configured for chain ${chainId}`, "unsupported_chain");
  const raw = (choice ?? "wbnb").trim();
  const lower = raw.toLowerCase();
  if (lower === "wbnb" || lower === "a") return pair.A;
  if (lower === "usdt" || lower === "b") return pair.B;
  const match = [pair.A, pair.B].find((t) => t.address.toLowerCase() === lower);
  if (!match) throw new CliError(`${raw} is not one of the vault's bound tokens (${pair.A.symbol}, ${pair.B.symbol})`, "bad_token");
  return match;
}

export function percentToBps(raw: string | undefined, fallback: number, what: string): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new CliError(`${what} must be a positive percent`, "bad_percent");
  return Math.round(value * 100);
}

export function expiryFor(days: string | undefined, now = Math.floor(Date.now() / 1000)): number {
  const n = days === undefined ? 1 : Number(days);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TERM_DAYS) {
    throw new CliError(`the term is 1 to ${MAX_TERM_DAYS} days`, "bad_term");
  }
  return Math.min(now + n * 86_400, now + MAX_TERM_DAYS * 86_400) - 60;
}

// the same price-per-base the page shows, from the pool's own slot0
export function quotePerBase(sqrtPriceX96: bigint, baseIsToken0: boolean): number {
  if (sqrtPriceX96 <= 0n) return 0;
  const Q192 = 1n << 192n;
  const scale = 10n ** 18n;
  const token1PerToken0 = (sqrtPriceX96 * sqrtPriceX96 * scale) / Q192;
  if (token1PerToken0 === 0n) return 0;
  if (baseIsToken0) return Number(token1PerToken0) / 1e18;
  return Number((scale * scale) / token1PerToken0) / 1e18;
}

export async function readFeeTiers(
  client: ReturnType<typeof publicClient>,
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
): Promise<FeeChoice[]> {
  const out: FeeChoice[] = [];
  for (const fee of FEE_TIERS) {
    try {
      const pool = await client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [tokenA, tokenB, fee] });
      if (!pool || /^0x0{40}$/i.test(pool)) continue;
      const liquidity = await client.readContract({ address: pool, abi: POOL_ABI, functionName: "liquidity" });
      let twapOk = true;
      try {
        await client.readContract({ address: pool, abi: POOL_ABI, functionName: "observe", args: [[1800, 0]] });
      } catch {
        twapOk = false;
      }
      let price: number | null = null;
      try {
        const slot = await client.readContract({ address: pool, abi: POOL_ABI, functionName: "slot0" });
        price = quotePerBase(slot[0], tokenA.toLowerCase() < tokenB.toLowerCase());
      } catch {
        price = null;
      }
      out.push({ fee, pool, liquidity, twapOk, price });
    } catch {
      // a tier that does not answer is not offered
    }
  }
  return out;
}

export function pickFeeTier(options: FeeChoice[], wanted?: string): FeeChoice {
  if (wanted !== undefined && wanted !== "" && wanted.toLowerCase() !== "auto") {
    const tier = Number(wanted);
    const found = options.find((o) => o.fee === tier);
    if (!found) throw new CliError(`the ${wanted} fee tier has no pool for this pair`, "no_pool");
    if (!found.twapOk) throw new CliError(`the ${wanted} fee tier has no price history, so the vault cannot price it`, "no_twap");
    return found;
  }
  const usable = options.filter((o) => o.twapOk);
  if (usable.length === 0) throw new CliError("no pool for this pair has enough price history to open a hire", "no_twap");
  return usable.reduce((best, o) => (o.liquidity > best.liquidity ? o : best));
}

async function vaultAddress(config: CliConfig): Promise<`0x${string}`> {
  const body = await apiRequest<{ vaults?: { chainId?: number; address?: string }[] }>(
    config.apiUrl,
    `/api/vault${query({ chain: config.chainId })}`,
    { timeoutMs: 60_000 },
  );
  const row = (body.vaults ?? []).find((v) => Number(v.chainId) === config.chainId);
  if (!row?.address || !/^0x[0-9a-fA-F]{40}$/.test(row.address)) {
    throw new CliError(`no HireVault is configured for chain ${config.chainId}`, "no_vault");
  }
  return row.address as `0x${string}`;
}

async function openHireCount(client: ReturnType<typeof publicClient>, vault: `0x${string}`, buyer: `0x${string}`): Promise<{ open: number; total: number }> {
  const ids = await client.readContract({ address: vault, abi: VAULT_ABI, functionName: "hiresOf", args: [buyer] });
  let open = 0;
  for (const id of ids) {
    try {
      const hire = await client.readContract({ address: vault, abi: VAULT_ABI, functionName: "hire", args: [id] });
      if (hire[4]) open += 1;
    } catch {
      // a hire that cannot be read is not counted as open
    }
  }
  return { open, total: ids.length };
}

export async function planVaultHire(
  config: CliConfig,
  client: `0x${string}`,
  chainId: number,
  tokenId: string,
  options: VaultHireOptions,
): Promise<VaultHirePlan> {
  if (chainId !== config.chainId) throw new CliError(`this CLI is set to chain ${config.chainId}, not ${chainId}`, "wrong_chain");
  const pair = TOKENS[chainId];
  if (!pair) throw new CliError(`no vault token pair is configured for chain ${chainId}`, "unsupported_chain");
  const token = tokenFor(chainId, options.token);

  const amountText = (options.deposit ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(amountText)) throw new CliError("--deposit must be a positive number", "bad_amount");
  const amount = parseUnits(amountText, token.decimals);
  if (amount <= 0n) throw new CliError("--deposit must be greater than zero", "bad_amount");

  const detail = await showAgent(config, chainId, tokenId);
  const walletRaw = (detail as { agent_wallet?: string | null }).agent_wallet ?? detail.owner_address ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletRaw)) throw new CliError(`${detail.name ?? tokenId} names no agent wallet to hire`, "no_agent_wallet");
  const agentWallet = walletRaw as `0x${string}`;

  const vault = await vaultAddress(config);
  const pub = publicClient(config);

  const [capA, capB, floor, maxOpen, count, allowance, bnbBalance] = await Promise.all([
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "capA" }).catch(() => 0n),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "capB" }).catch(() => 0n),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "minDepositInToken0" }).catch(() => 0n),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "MAX_OPEN_PER_BUYER" }).catch(() => 0n),
    openHireCount(pub, vault, client),
    pub.readContract({ address: token.address, abi: TOKEN_ABI, functionName: "allowance", args: [client, vault] }).catch(() => 0n),
    pub.getBalance({ address: client }).catch(() => 0n),
  ]);

  const cap = token.address.toLowerCase() === pair.A.address.toLowerCase() ? capA : capB;
  if (cap > 0n && amount > cap) {
    throw new CliError(`the deposit is over this vault's cap of ${formatUnits(cap, 18)} ${token.symbol}`, "over_cap");
  }
  // the contract floors a deposit valued in token0; on both live pairs that is
  // USDT, so a WBNB deposit is valued at open and refused there if it lands under
  const floorText = floor > 0n ? formatUnits(floor, 18) : null;
  if (floorText && token.address.toLowerCase() === pair.B.address.toLowerCase() && amount < floor) {
    throw new CliError(`the vault refuses a deposit under ${floorText} ${token.symbol}`, "under_floor");
  }
  const maxOpenCount = maxOpen > 0n ? Number(maxOpen) : null;
  if (maxOpenCount !== null && count.open >= maxOpenCount) {
    throw new CliError(`this wallet already holds ${count.open} live hires, the most the vault accepts`, "queue_full");
  }

  const expiry = expiryFor(options.days);
  const slippageBps = percentToBps(options.slippage, 500, "slippage");
  if (slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new CliError(`slippage is 0.01 to ${MAX_SLIPPAGE_BPS / 100} percent`, "bad_slippage");
  }
  const agentFeeBps = percentToBps(options.agentFee, 0, "the agent fee");
  const maxLossBps = percentToBps(options.maxLoss, 2000, "the max loss");
  if (agentFeeBps > 10_000 || maxLossBps > 10_000) throw new CliError("fees and loss are at most 100 percent", "bad_percent");

  let venue: `0x${string}` = ZERO;
  if (options.venue !== undefined && options.venue !== "" && options.venue.toLowerCase() !== "none") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(options.venue)) throw new CliError("--venue must be an address or none", "bad_venue");
    venue = options.venue as `0x${string}`;
  }

  const tiers = await readFeeTiers(pub, pair.A.address, pair.B.address);
  const chosen = pickFeeTier(tiers, options.fee);

  const balance = await pub.readContract({ address: token.address, abi: TOKEN_ABI, functionName: "balanceOf", args: [client] }).catch(() => 0n);
  const needsApprove = allowance < amount;
  // a WBNB deposit is wrapped from BNB for whatever the wallet does not already hold
  const wrapWei = token.address.toLowerCase() === pair.A.address.toLowerCase() && balance < amount ? amount - balance : 0n;
  if (wrapWei > 0n && bnbBalance < wrapWei) {
    throw new CliError(`wrapping needs ${formatUnits(wrapWei, 18)} BNB, and this wallet holds ${formatUnits(bnbBalance, 18)}`, "insufficient_bnb");
  }

  const gasPrice = await pub.getGasPrice();
  const openArgs = [agentWallet, token.address, amount, BigInt(expiry), slippageBps, chosen.fee, agentFeeBps, maxLossBps, venue] as const;
  // an open that still needs an approval cannot be simulated yet: the vault's
  // transferFrom would revert in the estimate. The send path approves first and
  // lets viem estimate then, so the preview uses a conservative figure.
  const FALLBACK_OPEN_GAS = 600_000n;
  const [openGas, approveGas, wrapGas] = await Promise.all([
    needsApprove
      ? Promise.resolve(FALLBACK_OPEN_GAS)
      : pub.estimateContractGas({ account: client, address: vault, abi: VAULT_ABI, functionName: "open", args: openArgs }).catch(() => null),
    needsApprove
      ? pub.estimateContractGas({ account: client, address: token.address, abi: TOKEN_ABI, functionName: "approve", args: [vault, amount] }).catch(() => null)
      : Promise.resolve(null),
    wrapWei > 0n ? pub.estimateContractGas({ account: client, address: token.address, abi: WRAP_ABI, functionName: "deposit", args: [], value: wrapWei }).catch(() => null) : Promise.resolve(null),
  ]);
  if (openGas === null) throw new CliError("the vault refused to estimate this open; check the amount, the term and the pool", "estimate_failed");

  return {
    chainId,
    tokenId,
    agentName: detail.name ?? tokenId,
    agentWallet,
    vault,
    client,
    token,
    amount,
    amountText,
    expiry,
    expiryIso: new Date(expiry * 1000).toISOString(),
    slippageBps,
    fee: chosen.fee,
    feeLabel: `${(chosen.fee / 10000).toFixed(2)}%`,
    pool: chosen.pool,
    agentFeeBps,
    maxLossBps,
    venue,
    capText: cap > 0n ? formatUnits(cap, 18) : "none",
    floorText,
    openCount: count.open,
    maxOpen: maxOpenCount,
    allowance,
    needsApprove,
    wrapWei,
    bnbBalance,
    gas: { wrap: wrapGas, approve: approveGas, open: openGas, gasPrice },
  };
}

export interface VaultHireResult {
  wrapHash?: string;
  approveHash?: string;
  openHash: string;
  hireId: string | null;
  policy: string | null;
  tagError: string | null;
}

export async function sendVaultHire(
  config: CliConfig,
  signer: LoadedSigner,
  plan: VaultHirePlan,
): Promise<VaultHireResult> {
  const wallet = walletClient(config, signer);
  const pub = publicClient(config);
  const sent: VaultHireResult = { openHash: "", hireId: null, policy: null, tagError: null };

  if (plan.wrapWei > 0n) {
    const hash = await wallet.writeContract({ address: plan.token.address, abi: WRAP_ABI, functionName: "deposit", value: plan.wrapWei });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new CliError("the wrap reverted, so nothing was opened", "wrap_failed");
    sent.wrapHash = hash;
  }
  if (plan.needsApprove) {
    const hash = await wallet.writeContract({ address: plan.token.address, abi: TOKEN_ABI, functionName: "approve", args: [plan.vault, plan.amount] });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new CliError("the approval reverted, so nothing was opened", "approve_failed");
    sent.approveHash = hash;
  }

  const hash = await wallet.writeContract({
    address: plan.vault,
    abi: VAULT_ABI,
    functionName: "open",
    args: [plan.agentWallet, plan.token.address, plan.amount, BigInt(plan.expiry), plan.slippageBps, plan.fee, plan.agentFeeBps, plan.maxLossBps, plan.venue],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new CliError("the open reverted, so no hire exists", "open_failed");
  sent.openHash = hash;

  // the policy tag is what tells the sweep which strategy runs this hire; a hire
  // that is not tagged waits, so the result says so rather than looking done
  try {
    const tag = await apiRequest<{ success?: boolean; hireId?: string; policy?: string; error?: string }>(
      config.apiUrl,
      "/api/vault/policy-tag/register",
      { method: "POST", body: { txHash: hash, chainId: config.chainId }, timeoutMs: 60_000 },
    );
    sent.hireId = tag.hireId ?? null;
    sent.policy = tag.policy ?? null;
    if (!tag.success) sent.tagError = tag.error ?? "the policy tag was refused";
  } catch (error) {
    sent.tagError = error instanceof Error ? error.message : String(error);
  }
  return sent;
}

export interface VaultWithdrawPlan {
  chainId: number;
  vault: `0x${string}`;
  id: string;
  buyer: string;
  agent: string;
  open: boolean;
  valueText: string | null;
  gas: bigint;
  gasPrice: bigint;
}

export async function planVaultWithdraw(
  config: CliConfig,
  buyer: `0x${string}`,
  id: string,
): Promise<VaultWithdrawPlan> {
  if (!/^\d+$/.test(id)) throw new CliError("<id> must be a hire id", "bad_id", 2);
  const vault = await vaultAddress(config);
  const pub = publicClient(config);
  const hire = await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "hire", args: [BigInt(id)] });
  if (hire[0].toLowerCase() !== buyer.toLowerCase()) {
    throw new CliError(`hire ${id} belongs to ${hire[0]}, not ${buyer}`, "not_buyer");
  }
  if (!hire[4]) throw new CliError(`hire ${id} is already closed`, "closed");
  const value = await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "valueInToken0", args: [BigInt(id)] }).catch(() => null);
  const [gas, gasPrice] = await Promise.all([
    pub.estimateContractGas({ account: buyer, address: vault, abi: VAULT_ABI, functionName: "withdraw", args: [BigInt(id)] }),
    pub.getGasPrice(),
  ]);
  return {
    chainId: config.chainId,
    vault,
    id,
    buyer,
    agent: hire[1],
    open: hire[4],
    valueText: value === null ? null : formatUnits(value, 18),
    gas,
    gasPrice,
  };
}

export async function sendVaultWithdraw(config: CliConfig, signer: LoadedSigner, plan: VaultWithdrawPlan): Promise<string> {
  const wallet = walletClient(config, signer);
  const hash = await wallet.writeContract({ address: plan.vault, abi: VAULT_ABI, functionName: "withdraw", args: [BigInt(plan.id)] });
  const receipt = await publicClient(config).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new CliError("the withdraw reverted, so the hire is still open", "withdraw_failed");
  return hash;
}

export function gasCost(gas: bigint | null, gasPrice: bigint): string {
  if (gas === null) return "-";
  return `${formatUnits(gas * gasPrice, 18)} BNB`;
}
