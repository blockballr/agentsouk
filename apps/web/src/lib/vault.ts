import { encodeFunctionData, parseUnits, formatUnits } from 'viem'

export const PANCAKE_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' as const

// the funded shape of a hire: the deposit sits in our own vault contract, the
// named agent trades inside the bounds the contract set at open, and the
// buyer's withdraw ends the agent's authority in one transaction. vault
// addresses are per chain; chain 56 waits on the outside review.

export const VAULT_BY_CHAIN: Record<number, string> = {
  97: '0xc742e51f3fe3875a3335700a7d692f40dc8e60b8',
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
  { label: 'Until I revoke', days: null },
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
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

const WITHDRAW_ABI = [
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
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

export function openCalldata(agent: string, token: string, amount: string, decimals: number, expiry: number, maxSlippageBps: number, fee: number): `0x${string}` {
  return encodeFunctionData({
    abi: OPEN_ABI,
    functionName: 'open',
    args: [agent as `0x${string}`, token as `0x${string}`, parseUnits(amount, decimals), BigInt(expiry), maxSlippageBps, fee],
  })
}

export function withdrawCalldata(id: bigint): `0x${string}` {
  return encodeFunctionData({ abi: WITHDRAW_ABI, functionName: 'withdraw', args: [id] })
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
  if (cap !== null && n > Number(cap)) return `The deposit is over this vault's cap of ${cap}.`
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
}

export const VAULT_ABIS = { hire: HIRE_ABI, hiresOf: HIRES_OF_ABI, caps: CAPS_ABI }
export const FACTORY = PANCAKE_V3_FACTORY
