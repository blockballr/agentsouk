import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { AgentSummary } from '@agora/core'
import { CATEGORIES } from '@agora/core'
import { getAgents } from '../lib/api'
import { VERDICT_DOT, verdictFor } from '../lib/verdict'

// search from anywhere: the nav icon or the / key opens it, Enter opens the highlighted agent
export function QuickSearch({ large }: { large?: boolean }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // the nav mounts one copy for wide screens and one for phones; only the shown one answers
      if (!trigger.current || trigger.current.offsetParent === null) return
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
      if ((e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) || (e.key === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search agents"
        title="Search agents  /"
        className={`flex items-center justify-center rounded-[4px] border hairline border-slate-verdant/40 text-newsprint-gray transition-colors hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black ${
          large ? 'h-11 w-11' : 'h-9 w-9'
        }`}
      >
        <SearchGlyph />
      </button>
      {/* portalled to the body: the header is its own stacking context, so a dialog
          left inside it sits under the compare bar and the sticky table column */}
      {open &&
        createPortal(
          <SearchDialog
            onClose={() => {
              setOpen(false)
              trigger.current?.focus()
            }}
          />,
          document.body,
        )}
    </>
  )
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const panel = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setItems([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    // a short pause so each keystroke does not become a request
    const t = window.setTimeout(() => {
      getAgents({ q: term, limit: 6 })
        .then((r) => {
          if (!cancelled) {
            setItems(r.items)
            setActive(0)
          }
        })
        .catch(() => {
          if (!cancelled) setItems([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [q])

  function go(path: string) {
    onClose()
    navigate(path)
  }

  // Escape anywhere closes; Tab stays inside the dialog, which is modal
  function onDialogKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const focusable = panel.current.querySelectorAll<HTMLElement>('input, button, a[href]')
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // the arrows and Enter belong to the search box alone, so a focused button keeps its own Enter
  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = items[active]
      if (pick) go(`/agents/${pick.chain_id}/${pick.token_id}`)
      else if (q.trim()) go(`/?q=${encodeURIComponent(q.trim())}`)
    }
  }

  const listId = 'quick-search-results'
  const optionId = (i: number) => `quick-search-option-${i}`

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" onKeyDown={onDialogKey}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Search agents"
        className="relative w-full max-w-xl overflow-hidden rounded-[14px] border hairline border-press-black/20 bg-bone-white shadow-[0_24px_60px_-16px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-center gap-3 border-b hairline border-slate-verdant/30 px-4">
          <span className="text-newsprint-gray">
            <SearchGlyph />
          </span>
          <input
            autoFocus
            type="search"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length > 0 ? optionId(active) : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search agents by name, skill or tag"
            aria-label="Search agents"
            className="h-14 w-full bg-transparent text-base text-press-black placeholder:text-newsprint-gray focus:outline-none"
          />
          <kbd className="micro hidden rounded-[4px] border hairline border-slate-verdant/40 px-1.5 py-0.5 text-newsprint-gray sm:inline">
            Esc
          </kbd>
        </div>

        {q.trim() === '' ? (
          <p className="px-4 py-5 text-[13px] text-newsprint-gray">Type a name, a skill such as health factor, or a tag.</p>
        ) : loading && items.length === 0 ? (
          <p className="px-4 py-5 text-[13px] text-newsprint-gray" role="status">
            Searching…
          </p>
        ) : items.length === 0 ? (
          <p className="px-4 py-5 text-[13px] text-newsprint-gray" role="status">
            Nothing matches &ldquo;{q.trim()}&rdquo;.
          </p>
        ) : (
          <ul id={listId} role="listbox" aria-label="Matching agents" className="max-h-[50vh] overflow-y-auto py-2">
            {items.map((a, i) => {
              const v = verdictFor(a.chain_id, a.verification)
              return (
                <li
                  key={a.agent_id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(`/agents/${a.chain_id}/${a.token_id}`)}
                  className={`flex cursor-pointer items-center justify-between gap-4 px-4 py-2.5 ${
                    i === active ? 'bg-echo-green/50' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-press-black">{a.name}</span>
                    <span className="block truncate text-[12px] text-newsprint-gray">{categoryName(a.category)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[12px] text-newsprint-gray">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${VERDICT_DOT[v.tone]}`} />
                    {v.label}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {q.trim() !== '' && (
          <button
            type="button"
            onClick={() => go(`/?q=${encodeURIComponent(q.trim())}`)}
            className="micro block w-full border-t hairline border-slate-verdant/30 px-4 py-3 text-left text-newsprint-gray transition hover:text-press-black"
          >
            See every match in the marketplace →
          </button>
        )}
      </div>
    </div>
  )
}

function categoryName(key: AgentSummary['category']): string {
  if (!key || key === 'general') return 'General'
  return CATEGORIES.find((c) => c.key === key)?.label ?? key
}

function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
