import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useConnectedAccount } from '../lib/use-connected-account'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'
const CONVERSATION_KEY = 'souk.assistant.conversation'
const STARTERS = [
  'Which agent can protect my Venus loan?',
  'Which stock pools are earning on Flux LP?',
  'How do I list my agent?',
]

const ASK_EVENT = 'souk.assistant.ask'

// any page can open the chat with a question; the visible Ask button answers it
export function askAssistant(question: string) {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: question }))
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

function conversationId(): string {
  try {
    const known = localStorage.getItem(CONVERSATION_KEY)
    if (known) return known
    const fresh = crypto.randomUUID()
    localStorage.setItem(CONVERSATION_KEY, fresh)
    return fresh
  } catch {
    return crypto.randomUUID()
  }
}

// the answer's light markdown as elements: links, bold, code and list lines. never raw html
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s)]+)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const href = match[2] ?? match[5]
    if (href) {
      out.push(
        <a key={match.index} href={href} className="text-souk-sky underline underline-offset-2 hover:text-souk-ink">
          {match[1] ?? href.replace(/^https:\/\/app\.agentsouk\.xyz/, '')}
        </a>,
      )
    } else if (match[3]) {
      out.push(<strong key={match.index} className="font-semibold text-souk-ink">{match[3]}</strong>)
    } else if (match[4]) {
      out.push(<code key={match.index} className="font-mono text-[12px]">{match[4]}</code>)
    }
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Answer({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const item = /^\s*[-*]\s+(.*)$/.exec(line)
        if (!line.trim()) return <span key={i} className="block h-2" />
        return (
          <Fragment key={i}>
            <span className={`block ${item ? 'pl-3' : ''}`}>
              {item ? '- ' : null}
              {inline((item ? item[1] : line).replace(/^#+\s*/, ''))}
            </span>
          </Fragment>
        )
      })}
    </>
  )
}

export function AssistantChat() {
  const wallet = useConnectedAccount()
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // the navbar mounts one Ask for wide screens and one for phones; only the one on screen answers
  useEffect(() => {
    const onAsk = (e: Event) => {
      if (!buttonRef.current?.offsetParent) return
      setOpen(true)
      void askRef.current((e as CustomEvent<string>).detail)
    }
    window.addEventListener(ASK_EVENT, onAsk)
    return () => window.removeEventListener(ASK_EVENT, onAsk)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, busy])

  async function ask(text: string) {
    const message = text.trim()
    if (!message || busy) return
    setDraft('')
    setTurns((t) => [...t, { role: 'user', text: message }])
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE}/assistant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, conversation: conversationId(), wallet: wallet ?? undefined }),
      })
      const body = (await res.json().catch(() => null)) as { reply?: string; error?: string } | null
      const reply = body?.reply ?? body?.error ?? 'The assistant did not answer. Try again in a minute.'
      setTurns((t) => [...t, { role: 'assistant', text: reply }])
    } catch {
      setTurns((t) => [...t, { role: 'assistant', text: 'The assistant could not be reached. Check your connection and try again.' }])
    } finally {
      setBusy(false)
    }
  }

  const askRef = useRef(ask)
  askRef.current = ask

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(draft)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Ask Agent Souk"
        className="flex h-[38px] min-w-[38px] shrink-0 items-center justify-center gap-2 rounded-[8px] border border-souk-hair px-2 sm:px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-souk-steel transition-colors hover:border-souk-data/50 hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        <span aria-hidden="true" className="hidden h-1.5 w-1.5 rounded-full bg-souk-data sm:inline-block" />
        {/* on a phone the bar is tight, so the button is a chat mark alone */}
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="sm:hidden">
          <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2v-7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span className="hidden sm:inline">Ask</span>
      </button>

      {/* rendered on the body: the navbar's blur would otherwise trap a fixed panel inside it */}
      {open
        ? createPortal(
        <div className="fixed inset-0 z-[70] flex justify-end">
          <button type="button" aria-label="Close the assistant" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-black/40" />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Ask Agent Souk"
            className="relative flex h-full w-full flex-col border-l border-souk-hair bg-souk-canvas sm:max-w-[420px]"
          >
            <header className="flex items-center justify-between border-b border-souk-hair px-4 py-3">
              <div className="min-w-0">
                <h2 className="m-0 text-[15px] font-semibold text-souk-ink">Ask Agent Souk</h2>
                <p className="m-0 truncate text-[12px] text-souk-labels">
                  {wallet ? 'Reads your connected wallet when you ask about your own' : 'Connect a wallet to ask about your own hires and agents'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-souk-hair text-souk-steel hover:text-souk-ink"
                aria-label="Close"
              >
                <span aria-hidden="true">x</span>
              </button>
            </header>

            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
              {turns.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-[14px] leading-[21px] text-souk-slate">
                    Ask in plain words. It finds agents, compares them, reads your hires and prepares the next step. Anything that pays
                    or signs opens for you to confirm in your own wallet.
                  </p>
                  <div className="flex flex-col gap-2">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void ask(s)}
                        className="rounded-[10px] border border-souk-hair px-3 py-2 text-left text-[13px] text-souk-ink transition-colors hover:border-souk-data/50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {turns.map((t, i) =>
                t.role === 'user' ? (
                  <div key={i} className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-souk-accent px-3 py-2 text-[13.5px] leading-[19px] text-souk-on-accent">
                    {t.text}
                  </div>
                ) : (
                  <div key={i} className="max-w-[92%] rounded-[14px] rounded-bl-[4px] border border-souk-hair bg-souk-surface1 px-3 py-2 text-[13.5px] leading-[20px] text-souk-slate">
                    <Answer text={t.text} />
                  </div>
                ),
              )}
              {busy ? <p className="text-[12px] text-souk-labels">Looking it up...</p> : null}
            </div>

            <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-souk-hair px-4 py-3">
              <label htmlFor="assistant-input" className="sr-only">
                Your question
              </label>
              <textarea
                id="assistant-input"
                ref={inputRef}
                rows={1}
                value={draft}
                maxLength={1500}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void ask(draft)
                  }
                }}
                placeholder="Ask anything..."
                className="max-h-32 min-h-[40px] flex-1 resize-none rounded-[10px] border border-souk-hair bg-souk-surface1 px-3 py-2 text-[16px] text-souk-ink placeholder:text-souk-muted focus-visible:outline-none sm:text-[14px]"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="h-10 shrink-0 rounded-[10px] bg-souk-accent px-4 text-[13px] font-semibold text-souk-on-accent disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </section>
        </div>,
            document.body,
          )
        : null}
    </>
  )
}
