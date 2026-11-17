import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  dismissNotifications,
  getNotifications,
  getTelegramDelivery,
  markNotificationsRead,
  startTelegramLink,
  unlinkTelegram,
  type NotificationRow,
  type TelegramDelivery,
} from '../lib/api'
import { useActiveAccount } from '../lib/use-active-account'
import { connectWalletWithTimeout, sessionProof } from '../lib/wallet-session'
import { walletErrorText } from '../lib/wallet-errors'
import { timeAgo } from '@agora/core'
import { IconBell } from './souk'

const OPEN_EVENT = 'souk.alerts.open'

// any part of the app can open the alert center, such as the account menu's Alerts row
export function openAlertCenter() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

type Section = 'inbox' | 'delivery'

// The bell: the unread count in the nav, and the alert center behind it. Alerts are private to the
// wallet, so reading them needs the signature this browser holds; without one the center asks for it.
export function NotificationBell() {
  const wallet = useActiveAccount()
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section>('inbox')
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [verified, setVerified] = useState<boolean | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const pull = useCallback(async () => {
    if (!wallet) return
    const proof = await sessionProof(wallet)
    setVerified(Boolean(proof))
    if (!proof) {
      setRows([])
      setUnread(0)
      return
    }
    const r = await getNotifications(wallet, proof).catch(() => null)
    if (r) {
      setRows(r.rows)
      setUnread(r.unread)
    }
  }, [wallet])

  useEffect(() => {
    if (!wallet) {
      setRows([])
      setUnread(0)
      setVerified(null)
      return
    }
    void pull()
    const tick = () => {
      if (document.visibilityState !== 'hidden') void pull()
    }
    const id = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [wallet, pull])

  useEffect(() => {
    // the bar has a bell for wide screens and one for phones; only the one on screen opens
    const onOpen = () => {
      if (buttonRef.current?.offsetParent) setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // opening the inbox marks what it shows as read
  useEffect(() => {
    if (!open || section !== 'inbox' || !wallet || unread === 0) return
    void (async () => {
      setUnread(0)
      setRows((prev) => prev.map((r) => ({ ...r, read: true })))
      const proof = await sessionProof(wallet)
      if (proof) await markNotificationsRead(wallet, proof).catch(() => {})
    })()
  }, [open, section, wallet, unread])

  async function onDismiss(row: NotificationRow) {
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    if (!wallet) return
    const proof = await sessionProof(wallet)
    if (proof) await dismissNotifications(wallet, proof, row.id).catch(() => {})
  }

  async function onClear() {
    setRows([])
    if (!wallet) return
    const proof = await sessionProof(wallet)
    if (proof) await dismissNotifications(wallet, proof).catch(() => {})
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
        className="flex h-[38px] min-w-[38px] shrink-0 items-center justify-center gap-2 rounded-[8px] border border-souk-hair px-2 text-souk-steel transition-colors hover:border-souk-data/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        <IconBell />
        {unread > 0 && (
          <span aria-hidden="true" className="flex h-[18px] items-center justify-center bg-souk-data px-1.5 font-mono text-[11px] font-bold leading-none text-souk-canvas">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-3">
              <button type="button" aria-label="Close alerts" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-black/50" />
              <section
                role="dialog"
                aria-modal="true"
                aria-label="Alert center"
                className="relative flex h-[min(620px,92vh)] w-full max-w-[760px] flex-col overflow-hidden rounded-[16px] border border-souk-hair bg-souk-canvas shadow-2xl"
              >
                <header className="flex items-center justify-between border-b border-souk-hair px-5 py-3.5">
                  <h2 className="m-0 text-[16px] font-semibold text-souk-ink">Alert center</h2>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-[8px] text-souk-steel hover:text-souk-ink">
                    x
                  </button>
                </header>
                <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                  <nav aria-label="Alert sections" className="flex shrink-0 gap-1 border-b border-souk-hair p-2 sm:w-[190px] sm:flex-col sm:justify-between sm:border-b-0 sm:border-r">
                    <SectionButton active={section === 'inbox'} onClick={() => setSection('inbox')}>
                      Inbox
                    </SectionButton>
                    <SectionButton active={section === 'delivery'} onClick={() => setSection('delivery')}>
                      Delivery settings
                    </SectionButton>
                  </nav>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {!wallet ? (
                      <Center title="Connect a wallet" body="Alerts belong to a wallet. Connect one to read yours and choose where they go.">
                        <VerifyButton label="Connect wallet" onDone={pull} />
                      </Center>
                    ) : verified === false ? (
                      <Center title="Verify your wallet" body="Sign a short message to read and manage your alerts. Signing is free and moves nothing.">
                        <VerifyButton label="Verify wallet" onDone={pull} />
                      </Center>
                    ) : section === 'inbox' ? (
                      <Inbox rows={rows} onDismiss={onDismiss} onClear={onClear} onNavigate={() => setOpen(false)} />
                    ) : (
                      <Delivery wallet={wallet} />
                    )}
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function SectionButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-[8px] px-3 py-2 text-left text-[13px] font-semibold transition-colors ${
        active ? 'bg-souk-surface2 text-souk-ink' : 'text-souk-steel hover:text-souk-ink'
      }`}
    >
      {children}
    </button>
  )
}

function Center({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="grid h-full min-h-[280px] place-items-center px-6 py-10 text-center">
      <div className="max-w-[360px]">
        <span aria-hidden="true" className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-[12px] bg-souk-surface2 text-souk-steel">
          <IconBell />
        </span>
        <h3 className="m-0 text-[15px] font-semibold text-souk-ink">{title}</h3>
        <p className="mt-1 text-[13px] leading-[19px] text-souk-steel">{body}</p>
        {children ? <div className="mt-4 flex justify-center">{children}</div> : null}
      </div>
    </div>
  )
}

function VerifyButton({ label, onDone }: { label: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  async function run() {
    setBusy(true)
    setNote(null)
    try {
      await connectWalletWithTimeout()
      await onDone()
    } catch (e) {
      setNote(walletErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid justify-items-center gap-2">
      <button type="button" onClick={() => void run()} disabled={busy} className="h-10 rounded-[8px] bg-souk-accent px-4 text-[13px] font-semibold text-souk-on-accent disabled:opacity-50">
        {busy ? 'Check your wallet...' : label}
      </button>
      {note ? <p className="m-0 text-[12px] text-souk-steel">{note}</p> : null}
    </div>
  )
}

function Inbox({
  rows,
  onDismiss,
  onClear,
  onNavigate,
}: {
  rows: NotificationRow[]
  onDismiss: (r: NotificationRow) => void
  onClear: () => void
  onNavigate: () => void
}) {
  if (rows.length === 0) {
    return (
      <Center
        title="No alerts yet"
        body="Alerts arrive when something happens to your hires and agents: a job delivered, a payment released or refunded, a listing failing its checks, a vault hire trading."
      >
        <Link to="/ongoing" onClick={onNavigate} className="inline-flex h-10 items-center rounded-[8px] bg-souk-accent px-4 text-[13px] font-semibold text-souk-on-accent">
          Open My hires
        </Link>
      </Center>
    )
  }
  return (
    <div>
      <div className="flex items-center justify-between px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-souk-labels">{rows.length} alerts</span>
        <button type="button" onClick={onClear} className="text-[12px] text-souk-steel hover:text-souk-ink">
          Clear all
        </button>
      </div>
      <ul className="divide-y divide-souk-hair border-t border-souk-hair">
        {rows.map((r) => (
          <li key={r.id} className={`flex items-start gap-3 px-5 py-3 ${r.read ? '' : 'bg-souk-surface1/60'}`}>
            <Link to={r.href ?? '/ongoing'} onClick={onNavigate} className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className={`text-[13.5px] font-semibold ${r.read ? 'text-souk-slate' : 'text-souk-ink'}`}>{r.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-souk-labels">{timeAgo(r.createdAt)}</span>
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-[18px] text-souk-steel">{r.body}</span>
            </Link>
            <button type="button" onClick={() => onDismiss(r)} aria-label="Dismiss" className="shrink-0 text-[12px] text-souk-labels hover:text-souk-ink">
              x
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Delivery({ wallet }: { wallet: string }) {
  const [state, setState] = useState<TelegramDelivery | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)

  const read = useCallback(async () => {
    const proof = await sessionProof(wallet)
    if (!proof) return
    const s = await getTelegramDelivery(wallet, proof)
    setFailed(!s)
    if (s) setState(s)
  }, [wallet])

  useEffect(() => {
    void read()
  }, [read])

  // after the bot opens in another tab, check back until the chat is linked, for up to two minutes
  useEffect(() => {
    if (!waiting) return
    let tries = 0
    const id = window.setInterval(() => {
      tries += 1
      void read()
      if (tries >= 24) setWaiting(false)
    }, 5000)
    return () => window.clearInterval(id)
  }, [waiting, read])

  useEffect(() => {
    if (state?.linked) setWaiting(false)
  }, [state])

  async function connect() {
    setBusy(true)
    const proof = await sessionProof(wallet)
    const url = proof ? await startTelegramLink(wallet, proof) : null
    setBusy(false)
    if (!url) {
      setFailed(true)
      return
    }
    window.open(url, '_blank', 'noopener')
    setWaiting(true)
  }

  async function disconnect() {
    setBusy(true)
    const proof = await sessionProof(wallet)
    if (proof) await unlinkTelegram(wallet, proof)
    await read()
    setBusy(false)
  }

  return (
    <div className="px-5 py-4">
      <h3 className="m-0 text-[15px] font-semibold text-souk-ink">Delivery settings</h3>
      <p className="mt-0.5 text-[13px] text-souk-steel">Choose where else your alerts go. The inbox here always keeps every one.</p>

      <div className="mt-5">
        <span className="text-[13px] font-semibold text-souk-ink">Telegram</span>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-[10px] border border-souk-hair bg-souk-surface1/60 px-4 py-3">
          <span className="min-w-0 truncate text-[13px] text-souk-slate">
            {state === null && !failed
              ? 'Reading...'
              : state?.linked
                ? `${state.username ? '@' + state.username : 'Linked'}${state.muted ? ', muted with /mute' : ''}`
                : waiting
                  ? 'Press Start in the bot, then come back here'
                  : 'Not connected'}
          </span>
          {state?.linked ? (
            <button type="button" onClick={() => void disconnect()} disabled={busy} className="shrink-0 text-[13px] font-semibold text-souk-peach disabled:opacity-50">
              Disconnect
            </button>
          ) : (
            <button type="button" onClick={() => void connect()} disabled={busy} className="shrink-0 text-[13px] font-semibold text-souk-sky disabled:opacity-50">
              {waiting ? 'Open again' : 'Connect'}
            </button>
          )}
        </div>
        {failed ? <p className="mt-2 text-[12px] text-souk-steel">Telegram settings could not be read just now. Try again in a minute.</p> : null}
      </div>

      <div className="mt-5">
        <span className="text-[13px] font-semibold text-souk-ink">Email</span>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-[10px] border border-souk-hair px-4 py-3">
          <span className="text-[13px] text-souk-labels">Email alerts are coming soon</span>
        </div>
      </div>
    </div>
  )
}
