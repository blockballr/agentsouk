import { decodeFunctionResult, encodeFunctionData, parseAbi, parseUnits } from 'viem'
import { rpcUrlsFor } from '@agora/core'
import { SETTLEMENT_ASSET_BY_CHAIN } from './contracts'

export const SWAP_CHAIN_ID = 56
export const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
// the BNB Chain stable the vault trades against WBNB
const USDT = '0x55d398326f99059fF775485246999027B3197955'
export const PANCAKE_V3_ROUTER = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'
export const PANCAKE_V3_QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'
export const SWAP_FEE_TIERS = [500, 2500, 100, 10000] as const
export const SWAP_SLIPPAGE_BPS = 50

// the tokens the panel can move: the chain's native coin, the wrapped coin the
// pools actually hold, the settlement token and the stable the vault trades
export type SwapSymbol = 'BNB' | 'WBNB' | 'USDT' | '$U'

export interface SwapToken {
  symbol: SwapSymbol
  /** null for the chain's native coin, which the pool sees wrapped as WBNB */
  address: string | null
  decimals: number
}

export const SWAP_TOKENS: Record<SwapSymbol, SwapToken> = {
  BNB: { symbol: 'BNB', address: null, decimals: 18 },
  WBNB: { symbol: 'WBNB', address: WBNB, decimals: 18 },
  USDT: { symbol: 'USDT', address: USDT, decimals: 18 },
  '$U': { symbol: '$U', address: SETTLEMENT_ASSET_BY_CHAIN[SWAP_CHAIN_ID].address, decimals: 18 },
}

export const SWAP_SYMBOLS = Object.keys(SWAP_TOKENS) as SwapSymbol[]

export const SWAP_TOKEN = SETTLEMENT_ASSET_BY_CHAIN[SWAP_CHAIN_ID].address
export const SWAP_SYMBOL = SETTLEMENT_ASSET_BY_CHAIN[SWAP_CHAIN_ID].symbol

export interface SwapQuote {
  fee: number
  amountIn: bigint
  amountOut: bigint
}

const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
])

const ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'function unwrapWETH9(uint256 amountMinimum,address recipient) payable',
  'function refundETH() payable',
])

const ERC20_ABI = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
])

// the address the pool sees: a native leg is traded as its wrapped form
export function poolAddress(symbol: SwapSymbol): `0x${string}` {
  const token = SWAP_TOKENS[symbol]
  return (token.address ?? WBNB) as `0x${string}`
}

function allowanceCalldata(owner: string, spender: string): `0x${string}` {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner as `0x${string}`, spender as `0x${string}`],
  })
}

async function readRpc(to: string, data: `0x${string}`): Promise<`0x${string}` | null> {
  for (const url of rpcUrlsFor(SWAP_CHAIN_ID)) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
      })
      const body = (await res.json()) as { result?: string; error?: unknown }
      if (!body.error && typeof body.result === 'string' && body.result.startsWith('0x')) {
        return body.result as `0x${string}`
      }
    } catch {
      // try the next endpoint
    }
  }
  return null
}

export async function quoteSwap(from: SwapSymbol, to: SwapSymbol, amountIn: bigint): Promise<SwapQuote | null> {
  if (amountIn <= 0n || from === to) return null
  const tokenIn = poolAddress(from)
  const tokenOut = poolAddress(to)
  let best: SwapQuote | null = null
  for (const fee of SWAP_FEE_TIERS) {
    const data = encodeFunctionData({
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    })
    const result = await readRpc(PANCAKE_V3_QUOTER, data)
    if (!result) continue
    try {
      const decoded = decodeFunctionResult({
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        data: result,
      })
      const amountOut = decoded[0]
      if (amountOut > 0n && (!best || amountOut > best.amountOut)) best = { fee, amountIn, amountOut }
    } catch {
      // a tier with no pool answers with a revert
    }
  }
  return best
}

/** An approval is meaningless for the native coin, which has no token contract. */
export async function readAllowance(owner: string, symbol: SwapSymbol): Promise<bigint | null> {
  const token = SWAP_TOKENS[symbol]
  if (!token.address) return null
  const result = await readRpc(token.address, allowanceCalldata(owner, PANCAKE_V3_ROUTER))
  return result ? BigInt(result) : null
}

export function approveSwapCalldata(
  symbol: SwapSymbol,
  amount: bigint,
): { to: `0x${string}`; data: `0x${string}` } {
  const token = SWAP_TOKENS[symbol]
  if (!token.address) throw new Error('the native coin needs no approval')
  return {
    to: token.address as `0x${string}`,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PANCAKE_V3_ROUTER as `0x${string}`, amount],
    }),
  }
}

export function swapCalldata(input: {
  from: SwapSymbol
  to: SwapSymbol
  amountIn: bigint
  amountOutMinimum: bigint
  fee: number
  recipient: string
}): { to: `0x${string}`; data: `0x${string}`; value?: string } {
  const tokenIn = poolAddress(input.from)
  const tokenOut = poolAddress(input.to)
  // a native output leaves the pool as WBNB, so the router receives it and the
  // unwrap hands the buyer real BNB; a token output goes straight to the buyer
  const nativeOut = SWAP_TOKENS[input.to].address === null
  const swap = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        fee: input.fee,
        recipient: (nativeOut ? PANCAKE_V3_ROUTER : input.recipient) as `0x${string}`,
        amountIn: input.amountIn,
        amountOutMinimum: input.amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })
  const nativeIn = SWAP_TOKENS[input.from].address === null
  const calls = nativeOut
    ? [
        swap,
        encodeFunctionData({
          abi: ROUTER_ABI,
          functionName: 'unwrapWETH9',
          args: [input.amountOutMinimum, input.recipient as `0x${string}`],
        }),
      ]
    : nativeIn
      ? [swap, encodeFunctionData({ abi: ROUTER_ABI, functionName: 'refundETH' })]
      : [swap]
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: 'multicall', args: [calls] })
  const value = nativeIn ? `0x${input.amountIn.toString(16)}` : undefined
  return { to: PANCAKE_V3_ROUTER, data, value }
}

export function parseSwapAmount(text: string): bigint | null {
  try {
    const trimmed = text.trim()
    if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return null
    return parseUnits(trimmed, 18)
  } catch {
    return null
  }
}

export function minimumOut(amountOut: bigint): bigint {
  return (amountOut * BigInt(10_000 - SWAP_SLIPPAGE_BPS)) / 10_000n
}
