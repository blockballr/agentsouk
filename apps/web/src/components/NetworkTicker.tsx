import { useEffect, useState } from 'react'
import { latestQuestProgress, questModeFor, requiredDone } from '../lib/quest'
import { sessionAccount } from '../lib/wallet-session'
import { getNetwork } from '../lib/api'
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
  extraMetrics?: TickerMetric[]
  className?: string
}

export function NetworkTicker({
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

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await getNetwork()
        if (cancelled) return
        if (r.data.price !== null) setPrice(r.data.price)
        if (r.data.tps !== null) setTps(r.data.tps)
      } catch {
        // keep the last reading
      }
    }
    const startId = window.setTimeout(load, 1_500)
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void load()
    }, 60_000)
    return () => {
      cancelled = true
      window.clearTimeout(startId)
      window.clearInterval(id)
    }
  }, [])

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

          <span className="hidden items-center gap-1.5 md:flex">
            <span className="text-souk-muted">TPS:</span>
            <span className="text-souk-ink font-semibold">{tps !== null ? tps.toLocaleString() : '-'}</span>
          </span>

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
