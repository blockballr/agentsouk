import { useEffect, useState } from 'react'
import { createPublicClient, erc20Abi, fallback, formatUnits, http } from 'viem'
import { bsc, bscTestnet } from 'viem/chains'
import { SETTLEMENT_ASSET_BY_CHAIN } from './contracts'
import { webRpcUrls } from './wallet'

const USDT_MAINNET = '0x55d398326f99059fF775485246999027B3197955'

export interface Balance {
  symbol: string
  amount: number
}

export interface WalletBalances {
  native: Balance
  tokens: Balance[]
}

async function readBalances(wallet: string, chainId: number): Promise<WalletBalances> {
  const client = createPublicClient({
    chain: chainId === 97 ? bscTestnet : bsc,
    transport: fallback(webRpcUrls(chainId).map((u) => http(u))),
  })
  const owner = wallet as `0x${string}`
  const tokens: { symbol: string; address: string }[] = []
  const settlement = SETTLEMENT_ASSET_BY_CHAIN[chainId]
  if (settlement) tokens.push({ symbol: settlement.symbol.replace(/^\$/, ''), address: settlement.address })
  if (chainId === 56) tokens.push({ symbol: 'USDT', address: USDT_MAINNET })
  const [native, ...amounts] = await Promise.all([
    client.getBalance({ address: owner }),
    ...tokens.map(async (t) => {
      const [raw, decimals] = await Promise.all([
        client.readContract({ address: t.address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
        client.readContract({ address: t.address as `0x${string}`, abi: erc20Abi, functionName: 'decimals' }),
      ])
      return Number(formatUnits(raw, decimals))
    }),
  ])
  return {
    native: { symbol: chainId === 97 ? 'tBNB' : 'BNB', amount: Number(formatUnits(native, 18)) },
    tokens: tokens.map((t, i) => ({ symbol: t.symbol, amount: amounts[i] ?? 0 })),
  }
}

// the connected wallet's balances on the app's chain, read again when the tab comes back into view.
// a read that fails leaves null, so the bar shows the address alone rather than a wrong figure
export function useWalletBalances(wallet: string | null, chainId: number | null): WalletBalances | null {
  const [balances, setBalances] = useState<WalletBalances | null>(null)
  useEffect(() => {
    setBalances(null)
    if (!wallet || !chainId) return
    let alive = true
    const read = () => {
      readBalances(wallet, chainId)
        .then((b) => {
          if (alive) setBalances(b)
        })
        .catch(() => {
          if (alive) setBalances(null)
        })
    }
    read()
    const onVisible = () => {
      if (document.visibilityState === 'visible') read()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(read, 60_000)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [wallet, chainId])
  return balances
}

// a balance short enough for the bar: four places under 1, two above, thousands grouped
export function formatBalance(amount: number): string {
  if (amount === 0) return '0'
  if (amount < 0.0001) return '<0.0001'
  return amount.toLocaleString('en-US', { maximumFractionDigits: amount < 1 ? 4 : 2 })
}
