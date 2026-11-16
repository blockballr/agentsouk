import { useEffect, useState } from 'react'

export interface FeedItem {
  at: string
  agentName: string
  tokenId: string | null
  rail: 'vault' | 'escrow' | 'x402'
  kind: 'hire' | 'trade'
  amount: string | null
  symbol: string | null
  txHash: string
  detail: string
}

export interface FeedState {
  items: FeedItem[] | null
  unavailable: string[]
  failed: boolean
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

// polls once a minute, so the page keeps up without a reload
export function useProofFeed(limit = 30, tokenId?: string): FeedState {
  const [state, setState] = useState<FeedState>({ items: null, unavailable: [], failed: false })

  useEffect(() => {
    let alive = true
    const query = `limit=${limit}${tokenId ? `&tokenId=${encodeURIComponent(tokenId)}` : ''}`
    const read = () =>
      fetch(`${API_BASE}/proof/feed?${query}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (!alive) return
          if (body?.success) setState({ items: body.items ?? [], unavailable: body.unavailable ?? [], failed: false })
          else setState((s) => ({ ...s, failed: s.items === null }))
        })
        .catch(() => {
          if (alive) setState((s) => ({ ...s, failed: s.items === null }))
        })
    void read()
    const timer = window.setInterval(read, 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [limit, tokenId])

  return state
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export const RAIL_LABEL: Record<FeedItem['rail'], string> = {
  vault: 'Vault',
  escrow: 'Escrow',
  x402: 'Direct',
}
