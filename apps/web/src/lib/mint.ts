// Self-service minting of the test settlement asset; testnet only.

import { encodeFunctionData, parseUnits } from 'viem'
import { rpcUrlsFor } from '@agora/core'
import { SETTLEMENT_ASSET_BY_CHAIN } from './contracts'

export const TEST_CHAIN_ID = 97

// sUSD, our EIP-3009 settlement token on BSC testnet, read from the per-chain
// table so its address cannot drift from what the hire flow signs against.
export const SUSD_ADDRESS = SETTLEMENT_ASSET_BY_CHAIN[TEST_CHAIN_ID].address as `0x${string}`

// selector 0x40c10f19, same shape as WETH9's mint
const SUSD_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// a display guardrail, not a control: the contract is uncapped, so anyone can mint
export const MINT_PER_CLICK = parseUnits('10', 18)

export const FAUCET_URL = 'https://www.bnbchain.org/en/testnet-faucet'

// Chain reads go through the app's own RPC list, not the wallet's.
//
// The balance probe used to call the wallet's provider, which means it inherited
// whatever RPC the wallet had saved for that chain. When a wallet had the chain
// configured with an endpoint that had gone away, the probe failed, the app could
// not tell the visitor was short, and the mint button never appeared. Reading
// public chain state is not the wallet's job, and doing it here also gives us the
// failover list.
export async function readErc20Balance(
  token: string,
  owner: `0x${string}`,
  chainId: number,
): Promise<bigint | null> {
  const data = encodeBalanceOf(owner)
  for (const url of rpcUrlsFor(chainId)) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: token, data }, 'latest'],
        }),
      })
      const body = (await res.json()) as { result?: string }
      if (typeof body.result === 'string' && body.result.startsWith('0x')) {
        return BigInt(body.result)
      }
    } catch {
      // try the next endpoint
    }
  }
  return null
}

export function isTestnet(chainId: number): boolean {
  return chainId === TEST_CHAIN_ID
}

/** Native balance via the app's own RPC list, for the gas check before a mint. */
export async function readNativeBalance(
  owner: `0x${string}`,
  chainId: number,
): Promise<bigint | null> {
  for (const url of rpcUrlsFor(chainId)) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [owner, 'latest'],
        }),
      })
      const body = (await res.json()) as { result?: string }
      if (typeof body.result === 'string' && body.result.startsWith('0x')) {
        return BigInt(body.result)
      }
    } catch {
      // try the next endpoint
    }
  }
  return null
}

export const SUSD_SYMBOL = SETTLEMENT_ASSET_BY_CHAIN[TEST_CHAIN_ID].symbol
export const SUSD_DECIMALS = 18

/** Ask the connected wallet to display sUSD via EIP-747; false if unsupported or declined. */
export async function watchSusd(provider: {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
}): Promise<boolean> {
  try {
    return Boolean(
      await provider.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: SUSD_ADDRESS,
            symbol: SUSD_SYMBOL,
            decimals: SUSD_DECIMALS,
          },
        },
      }),
    )
  } catch {
    // unsupported wallet, or the user dismissed the prompt
    return false
  }
}

export function encodeMint(to: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: SUSD_ABI,
    functionName: 'mint',
    args: [to, amount],
  })
}

export function encodeBalanceOf(account: `0x${string}`): `0x${string}` {
  return encodeFunctionData({
    abi: SUSD_ABI,
    functionName: 'balanceOf',
    args: [account],
  })
}

const ERC20_ERROR_NAMES: Record<string, string> = {
  ERC20InvalidReceiver: 'that address cannot hold tokens',
  ERC20InvalidSender: 'that address cannot send tokens',
}

/** Human-readable reason for a failed mint. */
export function explainMintFailure(code: number | undefined, message: string): string {
  if (code === 4001) return 'Rejected in your wallet, so nothing was minted.'
  if (code !== undefined) {
    const named = ERC20_ERROR_NAMES[code.toString()]
    if (named) return `The token contract rejected this: ${named}.`
    return `The transaction failed with code ${code}. ${message}`.trim()
  }
  if (/user rejected|user denied/i.test(message)) {
    return 'Rejected in your wallet, so nothing was minted.'
  }
  if (/insufficient funds/i.test(message)) {
    return 'Not enough BNB in this wallet to pay for the transaction itself.'
  }
  return message
}

/** True when the balance covers a single default-price hire. */
export function canAffordHire(balanceWei: bigint, priceWei: bigint): boolean {
  return balanceWei >= priceWei
}
