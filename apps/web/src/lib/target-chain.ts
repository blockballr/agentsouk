// One shared source of truth for the chain this deployment serves and the asset
// hires settle in. It starts unknown on purpose: wallet.ts keeps a default so
// signing has something to work with, but a render must never paint that guess
// as the deployment's chain. Surfaces read this and show pending until the
// server states the value.

import { useEffect, useSyncExternalStore } from 'react'
import { settlementAssetFor } from './contracts'

export interface TargetChain {
  chainId: number
  settlementSymbol: string | null
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

// null until the server states the chain: never the compiled-in default
let current: TargetChain | null = null
const listeners = new Set<() => void>()

export function subscribeTargetChain(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getTargetChainState(): TargetChain | null {
  return current
}

// The server is authoritative. A symbol may arrive with the chain; otherwise it
// is read from the published per-chain table. An absent or invalid chain is
// ignored so a bad payload cannot clear a chain we already know.
export function setTargetChainState(
  chainId: number | null | undefined,
  settlementSymbol?: string | null,
): void {
  if (chainId === null || chainId === undefined) return
  if (!Number.isFinite(chainId) || chainId <= 0) return
  // the published table is the display source, the server value the fallback
  const symbol = settlementAssetFor(chainId)?.symbol ?? settlementSymbol ?? null
  if (current?.chainId === chainId && current.settlementSymbol === symbol) return
  current = { chainId, settlementSymbol: symbol }
  for (const listener of listeners) listener()
}

// Ask the server once. Every caller awaits the same promise, a failed attempt is
// not retried, and a chain already learned elsewhere short-circuits the fetch.
let load: Promise<void> | null = null

export function ensureTargetChain(): Promise<void> {
  if (current) return Promise.resolve()
  if (load) return load
  load = fetch(`${API_BASE}/chain`)
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { chainId?: number; settlementSymbol?: string | null } | null) => {
      if (body) setTargetChainState(body.chainId, body.settlementSymbol)
    })
    .catch(() => {
      // stay unknown; a catalogue fetch is the other way the chain arrives
    })
  return load
}

// Components read the chain here and render pending while it is null. Mounting
// the hook is what bootstraps the one fetch, so the footer on every page is
// enough for a page that never calls the catalogue.
export function useTargetChain(): TargetChain | null {
  const value = useSyncExternalStore(subscribeTargetChain, getTargetChainState, () => null)
  useEffect(() => {
    void ensureTargetChain()
  }, [])
  return value
}
