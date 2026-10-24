import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { LOCALES, type LocaleCode } from '../lib/locale'
import { useI18n } from '../lib/i18n'

// Compact shortcut for the status bar. The full list stays in Settings; this
// popover just switches the active locale. Shows the code (not a flag) because
// flags are country-specific and wrong for languages.
export function LanguagePicker() {
  const { locale, setLocale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()

  const selected = Math.max(0, LOCALES.findIndex((l) => l.code === locale))
  const current = LOCALES[selected]

  function optionId(code: string) {
    return `${listId}-${code}`
  }

  function close(returnFocus = true) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  function openAt(index: number) {
    setActive(index)
    setOpen(true)
  }

  // outside click
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // move focus into the listbox when it opens
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openAt(e.key === 'ArrowDown' ? selected : (selected - 1 + LOCALES.length) % LOCALES.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openAt(selected)
    }
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % LOCALES.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + LOCALES.length) % LOCALES.length)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      setActive(LOCALES.length - 1)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const chosen = LOCALES[active]
      if (chosen) {
        setLocale(chosen.code as LocaleCode)
        close()
      }
    }
  }

  function choose(code: LocaleCode) {
    setLocale(code)
    close()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t('settings.language')}
        title={`${current.code} · ${current.label}`}
        onClick={() => (open ? close() : openAt(selected))}
        onKeyDown={onTriggerKey}
        className="flex h-[38px] min-w-[38px] items-center justify-center rounded-none border border-souk-hair px-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-souk-steel transition-colors hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        {current.code}
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t('settings.language')}
          aria-activedescendant={optionId(LOCALES[active].code)}
          tabIndex={-1}
          onKeyDown={onListKey}
          className="absolute bottom-full right-0 z-[80] mb-2 w-[220px] overflow-hidden rounded-none border border-souk-hair bg-souk-surface1 py-1 shadow-lg focus:outline-none"
        >
          {LOCALES.map((l, i) => {
            const isSelected = l.code === locale
            const isActive = i === active
            return (
              <button
                key={l.code}
                id={optionId(l.code)}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(l.code as LocaleCode)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-mono text-[11px] transition-colors ${
                  isActive ? 'bg-souk-surface2 text-souk-ink' : 'text-souk-slate'
                }`}
              >
                <span className="font-bold uppercase tracking-[0.08em]">{l.code}</span>
                <span className="text-[12px]">{l.label}</span>
                {isSelected ? (
                  <span aria-hidden="true" className="text-souk-data">
                    ✓
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
