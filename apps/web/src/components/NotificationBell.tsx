import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getNotifications, markNotificationsRead, type NotificationRow } from '../lib/api'
import { useActiveAccount } from '../lib/use-active-account'
import { timeAgo } from '@agora/core'
import { IconBell } from './souk'

// The bell: one unread count in the nav, one panel of outbox rows. It watches
// the wallet the same way the ongoing view does, so a release or a funded job
// lands here without any page knowing about notifications directly.
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const wallet = useActiveAccount()
  const box = useRef<HTMLDivElement | null>(null)

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
        className="flex h-[38px] min-w-[38px] shrink-0 items-center justify-center gap-2 rounded-[8px] border border-souk-hair px-2 text-souk-steel transition-colors hover:border-souk-data/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        <IconBell />
        {/* the design's badge rides inside the button: the count sits in the data green
            beside the bell rather than overlapping its corner */}
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="flex h-[18px] items-center justify-center rounded-[6px] bg-souk-data px-1.5 font-mono text-[11px] font-bold leading-none text-souk-canvas"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[340px] rounded-[20px] border border-souk-hair bg-souk-indigo/85 p-1 shadow-lg backdrop-blur-md ring-1 ring-white/10">
          {/* the outbox panel wears the account panel's shell: indigo navy under one
              rim, the hairline dividing the head from the rows without a box */}
          <p className="micro px-3 pb-1 pt-2 text-souk-indigo-labels">Activity</p>
          {rows.length === 0 ? (
            <p className="px-3 pb-3 pt-1 text-[13px] text-souk-indigo-labels">
              Nothing yet. Releases, funded jobs and seller replies land here.
            </p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {rows.map((r) => (
                <li key={r.id} className={r.read ? 'opacity-70' : ''}>
                  <Link
                    to={r.href ?? '/ongoing'}
                    onClick={() => setOpen(false)}
                    className="block rounded-[8px] px-3 py-2 hover:bg-white/10"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-[13px] font-medium ${r.read ? 'text-souk-indigo-labels' : 'text-white'}`}>{r.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-souk-indigo-labels">{timeAgo(r.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-souk-indigo-labels">{r.body}</p>
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
