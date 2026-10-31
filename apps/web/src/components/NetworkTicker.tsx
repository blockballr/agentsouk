import { useEffect, useRef, useState } from 'react'
import { latestQuestProgress, questModeFor, requiredDone } from '../lib/quest'
import { sessionAccount } from '../lib/wallet-session'
import { SwapTicker } from './SwapTicker'
import { ThemeToggle } from './ThemeToggle'
import { LanguagePicker } from './LanguagePicker'
import { SupportButton } from './SupportButton'
import { IconDocs } from './souk'
import { useI18n } from '../lib/i18n'

// Persistent network ticker: swap + price + TPS + extensible metrics.
// Self-contained polling, no provider needed, so it never flickers on route change.

export interface TickerMetric {
  label: string
  value: string | number
}

export interface NetworkTickerProps {
  priceUrl?: string
  pricePath?: (json: unknown) => number | null
  rpcUrl?: string
  pollMs?: number
  extraMetrics?: TickerMetric[]
  className?: string
}

const DEFAULT_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd'
const FALLBACK_PRICE_URL = 'https://api.coinbase.com/v2/prices/BNB-USD/spot'
const DEFAULT_RPC_URL = 'https://bsc-dataseed.bnbchain.org'

function readPrice(json: unknown): number | null {
  const v = (json as { binancecoin?: { usd?: number } })?.binancecoin?.usd
  return typeof v === 'number' ? v : null
}

function readFallbackPrice(json: unknown): number | null {
  const v = (json as { data?: { amount?: string } })?.data?.amount
  const n = typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export function NetworkTicker({
  priceUrl = DEFAULT_PRICE_URL,
  pricePath = readPrice,
  rpcUrl = DEFAULT_RPC_URL,
  pollMs = 60_000,
  extraMetrics = [],
  className = '',
}: NetworkTickerProps) {
  const { t } = useI18n()
  const [price, setPrice] = useState<number | null>(null)
  const [tps, setTps] = useState<number | null>(null)
  const [questMinimized, setQuestMinimized] = useState<boolean>(() => {
    try { return localStorage.getItem('agentsouk.quest.minimized') === '1' } catch { return false }
  })
  const [quest, setQuest] = useState<{ kind: 'start' } | { kind: 'resume'; done: number | null }>({
    kind: 'start',
  })

  async function refreshQuestLabel() {
    try {
      const wallet = await sessionAccount().catch(() => null)
      if (!wallet) { setQuest({ kind: 'start' }); return }
      const mode = questModeFor(wallet)
      if (mode === 'active' || mode === 'quit') {
        const cached = latestQuestProgress()
        const progress = cached && cached.wallet?.toLowerCase() === wallet.toLowerCase() ? cached : null
        const done = requiredDone(progress)
        setQuest({ kind: 'resume', done: done > 0 ? done : null })
      } else {
        setQuest({ kind: 'start' })
      }
    } catch {
      setQuest({ kind: 'start' })
    }
  }
  // rolling window of recent blocks for a real TPS reading
  const windowRef = useRef<{ number: number; txCount: number; ts: number }[]>([])

  useEffect(() => {
    let cancelled = false

    async function fetchPrice() {
      try {
        const res = await fetch(priceUrl)
        if (res.ok) {
          const p = pricePath(await res.json())
          if (!cancelled && p !== null) {
            setPrice(p)
            return
          }
        }
      } catch {
        // fall through to the fallback when the default feed is blocked
      }
      if (priceUrl !== DEFAULT_PRICE_URL || pricePath !== readPrice) return
      try {
        const res = await fetch(FALLBACK_PRICE_URL)
        if (!res.ok) return
        const p = readFallbackPrice(await res.json())
        if (!cancelled && p !== null) setPrice(p)
      } catch {
        // keep last value
      }
    }

    async function fetchTps() {
      try {
        const body = { jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) return
        const json = await res.json()
        const r = json?.result
        const blockNum = r?.number ? parseInt(r.number, 16) : null
        const txCount = Array.isArray(r?.transactions) ? r.transactions.length : null
        const ts = r?.timestamp ? parseInt(r.timestamp, 16) * 1000 : null
        if (blockNum === null || txCount === null || ts === null) return
        const w = windowRef.current
        // drop stale entries older than 60s
        const cutoff = ts - 60000
        const fresh = w.filter((e) => e.ts >= cutoff && e.number < blockNum)
        fresh.push({ number: blockNum, txCount, ts })
        windowRef.current = fresh
        // compute TPS over the window when we have at least two blocks
        if (fresh.length >= 2) {
          const first = fresh[0]
          const last = fresh[fresh.length - 1]
          const spanSec = (last.ts - first.ts) / 1000
          const txs = fresh.reduce((s, e) => s + e.txCount, 0) - first.txCount
          if (spanSec > 0) {
            const tpsVal = Math.round(txs / spanSec)
            if (!cancelled) setTps(tpsVal)
          }
        } else {
          // fallback estimate until the window fills
          if (!cancelled) setTps(Math.round(txCount / 3))
        }
      } catch {
        // keep last value
      }
    }

    // the ticker is decoration; let the page paint and fetch its own data first
    const startId = window.setTimeout(() => {
      fetchPrice()
      fetchTps()
    }, 1_500)
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      fetchPrice()
      fetchTps()
    }, pollMs)
    return () => {
      cancelled = true
      window.clearTimeout(startId)
      window.clearInterval(id)
    }
  }, [priceUrl, pricePath, rpcUrl, pollMs])

  // mirror the quest card's minimized state so a tab can summon it back
  useEffect(() => {
    const sync = () => {
      try { setQuestMinimized(localStorage.getItem('agentsouk.quest.minimized') === '1') } catch {}
      refreshQuestLabel()
    }
    const onVis = (e: Event) => {
      const detail = (e as CustomEvent).detail as { minimized?: boolean } | undefined
      if (detail?.minimized === true) { setQuestMinimized(true); refreshQuestLabel() }
      if (detail?.minimized === false) setQuestMinimized(false)
      sync()
    }
    window.addEventListener('agentsouk.quest.visibility', onVis)
    window.addEventListener('storage', sync)
    refreshQuestLabel()
    return () => {
      window.removeEventListener('agentsouk.quest.visibility', onVis)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return (
    <div
      className={`w-full border-t border-souk-hair bg-souk-surface1 ${className}`}
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      <div className="flex items-center gap-4 px-4 py-1.5 text-[0.75rem] whitespace-nowrap">
        <SwapTicker />

        {questMinimized && (
          <button
            type="button"
            data-quest-tab
            onClick={() => {
              try { localStorage.removeItem('agentsouk.quest.minimized') } catch {}
              setQuestMinimized(false)
              window.dispatchEvent(new CustomEvent('agentsouk.quest.visibility', { detail: { minimized: false } }))
            }}
            className="rounded-[5px] border border-souk-sky/40 px-2 py-1 text-[0.7rem] font-semibold text-souk-sky transition hover:bg-souk-sky/10"
          >
            {quest.kind === 'start'
              ? t('ticker.startQuest')
              : quest.done
                ? t('ticker.resumeQuestCount', { done: quest.done })
                : t('ticker.resumeQuest')}
          </button>
        )}

        <span className="ml-auto flex items-center gap-4">
          {/* price widget */}
          <span className="hidden items-center gap-1.5 sm:flex">
            <span className="text-souk-muted">BNB/$U</span>
            <span className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-souk-data/20 text-[9px] font-bold text-souk-data"
              >
                B
              </span>
              <span className="text-souk-ink font-semibold">
                {price !== null ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
              </span>
            </span>
          </span>

          {/* tps widget */}
          <span className="hidden items-center gap-1.5 md:flex">
            <span className="text-souk-muted">TPS:</span>
            <span className="text-souk-ink font-semibold">{tps !== null ? tps.toLocaleString() : '-'}</span>
          </span>

          {/* extensible metrics */}
          <span className="hidden items-center gap-3 lg:flex">
            {extraMetrics.map((m, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="text-souk-muted">{m.label}:</span>
                <span className="text-souk-ink font-semibold">{m.value}</span>
              </span>
            ))}
          </span>

          <span className="text-souk-muted">|</span>
          <span className="flex items-center gap-2">
            <LanguagePicker />
            <ThemeToggle />
          </span>
          <span className="hidden text-souk-muted sm:inline">|</span>
          <a
            href="https://docs.agentsouk.xyz"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 sm:flex text-souk-indigo-link transition hover:text-souk-ink"
          >
            <IconDocs />
            {t('ticker.docs')}
          </a>
          <span className="hidden text-souk-muted sm:inline">|</span>
          <span className="hidden sm:flex">
            <SupportButton plain iconFirst />
          </span>
        </span>
      </div>
    </div>
  )
}

export default NetworkTicker
