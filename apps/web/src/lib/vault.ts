import { decodeFunctionResult, encodeFunctionData, parseUnits, formatUnits } from 'viem'

export const PANCAKE_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' as const

// the funded shape of a hire: the deposit sits in our own vault contract, the
// named agent trades inside the bounds the contract set at open, and the
// buyer's withdraw ends the agent's authority in one transaction. vault
// addresses are per chain; chain 56 redeployed with closeIfGoal and valueInToken0 (0xf3dfb43d7bdccbe8d612c712dcca148884fc68ec), mirrored from the server-side vault table

export const VAULT_BY_CHAIN: Record<number, string> = {
  56: import.meta.env.VITE_VAULT_ADDRESS_56 ?? '0x028129c230123a46f4305ce0d2b29f8ac5255149',
  97: import.meta.env.VITE_VAULT_ADDRESS_97 ?? '0xe1cd584d0bf2dbba90f84d5ac991984cae8f9d74',
}

export function vaultFor(chainId: number): string | null {
  return VAULT_BY_CHAIN[chainId] ?? null
}

export const MAX_SLIPPAGE_BPS = 1000
export const MAX_TERM_SECONDS = 90 * 24 * 60 * 60

export const EXPIRY_PRESETS: { label: string; days: number | null }[] = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
  { label: 'Until revoke', days: null },
]

const OPEN_ABI = [
  {
    name: 'open',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
      { name: 'maxSlippageBps', type: 'uint16' },
      { name: 'fee', type: 'uint24' },
      { name: 'agentFeeBps', type: 'uint16' },
      { name: 'maxLossBps', type: 'uint16' },
      { name: 'venue', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

const WITHDRAW_ABI = [
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
] as const

const CLOSE_IF_GOAL_ABI = [
  { name: 'closeIfGoal', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'goalValueInToken0', type: 'uint256' }], outputs: [] },
] as const

const VALUE_IN_TOKEN0_ABI = [
  { name: 'valueInToken0', type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

const WRAP_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
] as const

const APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

const HIRE_ABI = [
  { name: 'hire', type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [
    { name: 'buyer', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'expiry', type: 'uint64' },
    { name: 'maxSlippageBps', type: 'uint16' },
    { name: 'open', type: 'bool' },
    { name: 'balanceA', type: 'uint256' },
    { name: 'balanceB', type: 'uint256' },
    { name: 'refPriceX96', type: 'uint160' },
    { name: 'fee', type: 'uint24' },
    { name: 'depositInToken0', type: 'uint256' },
    { name: 'deployedB', type: 'uint256' },
    { name: 'agentFeeBps', type: 'uint16' },
    { name: 'highWaterMark', type: 'uint256' },
    { name: 'maxLossBps', type: 'uint16' },
    { name: 'venue', type: 'address' },
  ] },
] as const

const HIRES_OF_ABI = [
  { name: 'hiresOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'buyer', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }] },
] as const

const CAPS_ABI = [
  { name: 'capA', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'capB', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const

// tokens read back on chain (symbol and decimals) and pinned per chain; these
// are the pair the deployment binds, so they are constants here, not imports
interface PancakeLike {
  symbol: string
  address: `0x${string}`
  decimals: number
}

const VAULT_TOKENS: Record<number, { A: PancakeLike; B: PancakeLike }> = {
  56: {
    A: { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
    B: { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  },
  97: {
    A: { symbol: 'WBNB', address: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', decimals: 18 },
    B: { symbol: 'USDT', address: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd', decimals: 18 },
  },
}

// the tokenA of the bound pair; tokenB is the vault's own quote stable
export function vaultTokenA(chainId: number): PancakeLike | null {
  return VAULT_TOKENS[chainId]?.A ?? null
}

export function vaultTokenB(chainId: number): PancakeLike | null {
  return VAULT_TOKENS[chainId]?.B ?? null
}

export function openCalldata(agent: string, token: string, amount: string, decimals: number, expiry: number, maxSlippageBps: number, fee: number, agentFeeBps: number, maxLossBps: number, venue: string): `0x${string}` {
  return encodeFunctionData({
    abi: OPEN_ABI,
    functionName: 'open',
    args: [agent as `0x${string}`, token as `0x${string}`, parseUnits(amount, decimals), BigInt(expiry), maxSlippageBps, fee, agentFeeBps, maxLossBps, venue as `0x${string}`],
  })
}

export function withdrawCalldata(id: bigint): `0x${string}` {
  return encodeFunctionData({ abi: WITHDRAW_ABI, functionName: 'withdraw', args: [id] })
}

export function closeIfGoalCalldata(id: bigint, goalValueInToken0: bigint): `0x${string}` {
  return encodeFunctionData({ abi: CLOSE_IF_GOAL_ABI, functionName: 'closeIfGoal', args: [id, goalValueInToken0] })
}

export function valueInToken0Calldata(id: bigint): `0x${string}` {
  return encodeFunctionData({ abi: VALUE_IN_TOKEN0_ABI, functionName: 'valueInToken0', args: [id] })
}

// wrapping tBNB into the bound WBNB so a deposit can be approved
export function wrapCalldata(): `0x${string}` {
  return encodeFunctionData({ abi: WRAP_ABI, functionName: 'deposit', args: [] })
}

// the exact-amount approval the open will spend from: scoped to one deposit, no blanket number
export function approveCalldata(spender: string, amount: string, decimals: number): `0x${string}` {
  return encodeFunctionData({
    abi: APPROVE_ABI,
    functionName: 'approve',
    args: [spender as `0x${string}`, parseUnits(amount, decimals)],
  })
}

export function expiryFor(days: number | null): number {
  const horizon = Math.floor(Date.now() / 1000) + (days !== null ? days : MAX_TERM_SECONDS) * 24 * 60 * 60
  // the contract refuses expiry past MAX_TERM from now, and nothing in the panel
  // may race it: the farthest preset is the cap itself
  return Math.min(horizon, Math.floor(Date.now() / 1000) + MAX_TERM_SECONDS) - 60
}

export function checkSlippage(bps: number): string | null {
  if (!Number.isInteger(bps) || bps < 1 || bps > MAX_SLIPPAGE_BPS) {
    return `Slippage is 1 to ${MAX_SLIPPAGE_BPS} basis points.`
  }
  return null
}

export function checkAmount(amount: string, cap: string | null): string | null {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return 'The deposit must be a positive number.'
  // a cap of 0 (unset or unread) is not a real limit; the contract itself
  // enforces the real cap, so the client must not block on a missing read.
  if (cap !== null && Number(cap) > 0 && n > Number(cap)) return `The deposit is over this vault's cap of ${cap}.`
  return null
}

export function readHire(raw: readonly unknown[]): VaultHire {
  return {
    buyer: raw[0] as string,
    agent: raw[1] as string,
    expiry: Number(raw[2]),
    maxSlippageBps: Number(raw[3]),
    open: raw[4] as boolean,
    balanceA: formatUnits(raw[5] as bigint, 18),
    balanceB: formatUnits(raw[6] as bigint, 18),
    refPriceX96: String(raw[7]),
    fee: Number(raw[8]),
    depositInToken0: String(raw[9]),
    deployedB: formatUnits(raw[10] as bigint, 18),
    agentFeeBps: Number(raw[11]),
    highWaterMark: String(raw[12]),
    maxLossBps: Number(raw[13]),
    venue: String(raw[14]),
  }
}

export interface VaultHire {
  buyer: string
  agent: string
  expiry: number
  maxSlippageBps: number
  open: boolean
  balanceA: string
  balanceB: string
  refPriceX96: string
  fee: number
  depositInToken0: string
  deployedB: string
  agentFeeBps: number
  highWaterMark: string
  maxLossBps: number
  venue: string
}

export const VAULT_ABIS = { hire: HIRE_ABI, hiresOf: HIRES_OF_ABI, caps: CAPS_ABI }
export const FACTORY = PANCAKE_V3_FACTORY

export const FEE_TIERS = [100, 500, 2500, 10000] as const

export interface FeeChoice {
  fee: number
  pool: string
  liquidity: bigint
  twapOk: boolean
  // quote per base from slot0, the same scale the vault's reference price uses
  price: number | null
}

const FACTORY_ABI = [
  {
    name: 'getPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }, { name: 'b', type: 'address' }, { name: 'fee', type: 'uint24' }],
    outputs: [{ type: 'address' }],
  },
] as const

const POOL_ABI = [
  { name: 'liquidity', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  {
    name: 'slot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint32' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  {
    name: 'observe',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'uint32[]' }],
    outputs: [{ type: 'int56[]' }, { type: 'uint160[]' }],
  },
] as const

// the bound pair is 18/18, so the tick ratio needs no decimal adjustment. base
// is tokenA and quote is tokenB, which is how the vault reads its own price.
export function quotePerBase(sqrtPriceX96: bigint, baseIsToken0: boolean): number {
  if (sqrtPriceX96 <= 0n) return 0
  const Q192 = 1n << 192n
  const scale = 10n ** 18n
  const token1PerToken0 = (sqrtPriceX96 * sqrtPriceX96 * scale) / Q192
  if (token1PerToken0 === 0n) return 0
  if (baseIsToken0) return Number(token1PerToken0) / 1e18
  return Number((scale * scale) / token1PerToken0) / 1e18
}

export async function readFeeTiers(
  read: (to: string, data: `0x${string}`) => Promise<`0x${string}`>,
  tokenA: string,
  tokenB: string,
): Promise<FeeChoice[]> {
  const out: FeeChoice[] = []
  for (const fee of FEE_TIERS) {
    try {
      const poolData = await read(
        FACTORY,
        encodeFunctionData({ abi: FACTORY_ABI, functionName: 'getPool', args: [tokenA as `0x${string}`, tokenB as `0x${string}`, fee] }),
      )
      const pool = decodeFunctionResult({ abi: FACTORY_ABI, functionName: 'getPool', data: poolData }) as string
      if (!pool || /^0x0{40}$/i.test(pool)) continue
      const liquidity = decodeFunctionResult({
        abi: POOL_ABI,
        functionName: 'liquidity',
        data: await read(pool, encodeFunctionData({ abi: POOL_ABI, functionName: 'liquidity' })),
      }) as bigint
      let twapOk = true
      try {
        await read(pool, encodeFunctionData({ abi: POOL_ABI, functionName: 'observe', args: [[1800, 0]] }))
      } catch {
        twapOk = false
      }
      let price: number | null = null
      try {
        const slot = decodeFunctionResult({
          abi: POOL_ABI,
          functionName: 'slot0',
          data: await read(pool, encodeFunctionData({ abi: POOL_ABI, functionName: 'slot0' })),
        }) as readonly [bigint, number, number, number, number, number, boolean]
        price = quotePerBase(slot[0], tokenA.toLowerCase() < tokenB.toLowerCase())
      } catch {
        price = null
      }
      out.push({ fee, pool, liquidity, twapOk, price })
    } catch {
      // a tier that does not answer is not offered
    }
  }
  return out
}

export function pickFeeTier(options: FeeChoice[]): FeeChoice | null {
  const usable = options.filter((o) => o.twapOk)
  if (usable.length === 0) return null
  return usable.reduce((best, o) => (o.liquidity > best.liquidity ? o : best))
}

export function feeLabel(fee: number): string {
  return `${(fee / 10000).toFixed(2)}%`
}

export async function tagHirePolicy(txHash: string): Promise<{ hireId: string; policy: string } | null> {
  const base = import.meta.env.VITE_API_URL ?? '/api'
  try {
    const res = await fetch(`${base}/vault/policy-tag/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txHash }),
    })
    if (!res.ok) return null
    const body = await res.json()
    return body?.ok ? { hireId: String(body.hireId), policy: String(body.policy) } : null
  } catch {
    return null
  }
}
