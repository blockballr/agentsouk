import { decodeFunctionResult, encodeFunctionData, parseAbi, parseUnits } from 'viem'
import { rpcUrlsFor } from '@agora/core'
import { SETTLEMENT_ASSET_BY_CHAIN } from './contracts'

export const SWAP_CHAIN_ID = 56
export const SWAP_TOKEN = SETTLEMENT_ASSET_BY_CHAIN[SWAP_CHAIN_ID].address
export const SWAP_SYMBOL = SETTLEMENT_ASSET_BY_CHAIN[SWAP_CHAIN_ID].symbol
export const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
export const PANCAKE_V3_ROUTER = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'
export const PANCAKE_V3_QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'
export const SWAP_FEE_TIERS = [500, 2500, 100, 10000] as const
export const SWAP_SLIPPAGE_BPS = 50

export type SwapDirection = 'bnb-to-u' | 'u-to-bnb'

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

function tokensFor(direction: SwapDirection): { tokenIn: `0x${string}`; tokenOut: `0x${string}` } {
  return direction === 'bnb-to-u'
    ? { tokenIn: WBNB, tokenOut: SWAP_TOKEN as `0x${string}` }
    : { tokenIn: SWAP_TOKEN as `0x${string}`, tokenOut: WBNB }
}

export async function quoteSwap(direction: SwapDirection, amountIn: bigint): Promise<SwapQuote | null> {
  if (amountIn <= 0n) return null
  const { tokenIn, tokenOut } = tokensFor(direction)
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

export async function readAllowance(owner: string): Promise<bigint | null> {
  const result = await readRpc(SWAP_TOKEN, allowanceCalldata(owner, PANCAKE_V3_ROUTER))
  return result ? BigInt(result) : null
}

export function approveSwapCalldata(amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [PANCAKE_V3_ROUTER as `0x${string}`, amount],
  })
}

export function swapCalldata(input: {
  direction: SwapDirection
  amountIn: bigint
  amountOutMinimum: bigint
  fee: number
  recipient: string
}): { to: `0x${string}`; data: `0x${string}`; value?: string } {
  const { tokenIn, tokenOut } = tokensFor(input.direction)
  const swap = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        fee: input.fee,
        recipient: (input.direction === 'bnb-to-u' ? input.recipient : PANCAKE_V3_ROUTER) as `0x${string}`,
        amountIn: input.amountIn,
        amountOutMinimum: input.amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })
  const calls =
    input.direction === 'bnb-to-u'
      ? [swap, encodeFunctionData({ abi: ROUTER_ABI, functionName: 'refundETH' })]
      : [
          swap,
          encodeFunctionData({
            abi: ROUTER_ABI,
            functionName: 'unwrapWETH9',
            args: [input.amountOutMinimum, input.recipient as `0x${string}`],
          }),
        ]
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: 'multicall', args: [calls] })
  const value =
    input.direction === 'bnb-to-u' ? `0x${input.amountIn.toString(16)}` : undefined
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
