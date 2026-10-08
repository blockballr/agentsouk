import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getNotifications, markNotificationsRead, type NotificationRow } from '../lib/api'
import { getActiveAccount } from '../lib/wallet'
import { timeAgo } from '@agora/core'

// The bell: one unread count in the nav, one panel of outbox rows. It watches
// the wallet the same way the ongoing view does, so a release or a funded job
// lands here without any page knowing about notifications directly.
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [wallet, setWallet] = useState<string | null>(null)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void getActiveAccount().then(setWallet)
  }, [])

  useEffect(() => {
    if (!wallet) {
      setRows([])
      setUnread(0)
      return
    }
    let cancelled = false
    const pull = () => {
      getNotifications(wallet)
        .then((r) => {
          if (!cancelled) {
            setRows(r.rows)
            setUnread(r.unread)
          }
        })
        .catch(() => {})
    }
    pull()
    const id = window.setInterval(pull, 15_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [wallet])

  useEffect(() => {
    if (!open) return
    const onAway = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onAway)
    return () => document.removeEventListener('mousedown', onAway)
  }, [open])

  async function onOpen() {
    const next = !open
    setOpen(next)
    if (next && wallet && unread > 0) {
      setUnread(0)
      setRows((prev) => prev.map((r) => ({ ...r, read: true })))
      await markNotificationsRead(wallet)
      const fresh = await getNotifications(wallet)
      setRows(fresh.rows)
      setUnread(fresh.unread)
    }
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative rounded-[6px] p-1 text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-highlighter-green px-1 text-[9px] font-semibold text-on-highlighter">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[340px] metal rounded-[12px] border hairline border-slate-verdant/40 p-1 shadow-lg">
          <p className="micro px-3 pb-1 pt-2 text-newsprint-gray">Activity</p>
          {rows.length === 0 ? (
            <p className="px-3 pb-3 pt-1 text-[13px] text-newsprint-gray">
              Nothing yet. Releases, funded jobs and seller replies land here.
            </p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {rows.map((r) => (
                <li key={r.id} className={r.read ? 'opacity-70' : ''}>
                  <Link
                    to={r.href ?? '/ongoing'}
                    onClick={() => setOpen(false)}
                    className="block rounded-[8px] px-3 py-2 hover:bg-press-black/[0.04]"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium text-press-black">{r.title}</span>
                      <span className="shrink-0 text-[11px] text-newsprint-gray">{timeAgo(r.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-newsprint-gray">{r.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
