import { useEffect, useState } from 'react'

// which seller wallets hold a Binance Agent ID, for the holder badge. yes or no only: the API never
// returns a name. answers are kept for the page's life so moving between pages does not refetch
const known = new Map<string, boolean>()

export function useAgentIdHolders(wallets: (string | null | undefined)[]): Set<string> {
  const key = [...new Set(wallets.filter((w): w is string => Boolean(w)).map((w) => w.toLowerCase()))].sort().join(',')
  const [, setTick] = useState(0)
  useEffect(() => {
    const missing = key ? key.split(',').filter((w) => !known.has(w)) : []
    if (missing.length === 0) return
    let alive = true
    const base = import.meta.env.VITE_API_URL ?? '/api'
    const batches: string[][] = []
    for (let i = 0; i < missing.length; i += 100) batches.push(missing.slice(i, i + 100))
    void Promise.all(
      batches.map((batch) =>
        fetch(`${base}/agent-id/holders?wallets=${batch.join(',')}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((body: { holders?: string[] } | null) => {
            if (!body?.holders) return
            const yes = new Set(body.holders.map((h) => h.toLowerCase()))
            for (const w of batch) known.set(w, yes.has(w))
          })
          .catch(() => {}),
      ),
    ).then(() => {
      if (alive) setTick((t) => t + 1)
    })
    return () => {
      alive = false
    }
  }, [key])
  return new Set(key ? key.split(',').filter((w) => known.get(w)) : [])
}
