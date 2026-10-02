import type { CheckMark } from '../components/ui'
import { readJsonBody } from './api'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export interface CheckRecord {
  status: string
  checkedAt: string
  responseMs: number | null
}

export async function getCheckHistory(tokenIds: string[]): Promise<Record<string, CheckRecord[]>> {
  if (tokenIds.length === 0) return {}
  const res = await fetch(`${BASE}/agents/checks?tokens=${encodeURIComponent(tokenIds.join(','))}`)
  if (!res.ok) throw new Error(`check history ${res.status}`)
  const body = await readJsonBody<{ checks?: Record<string, CheckRecord[]> }>(res, 'check history')
  return body.checks ?? {}
}

// oldest first, by UTC day as the server stamps them
export function countByDay(dates: string[], days = 14, now = Date.now()): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = []
  const index = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
    index.set(day, out.length)
    out.push({ day, count: 0 })
  }
  for (const d of dates) {
    const t = Date.parse(d)
    if (!Number.isFinite(t)) continue
    const at = index.get(new Date(t).toISOString().slice(0, 10))
    if (at !== undefined) out[at].count += 1
  }
  return out
}

export function checkMarks(checks: CheckRecord[]): CheckMark[] {
  return [...checks].reverse().map((c) => ({
    state: c.status === 'delivered' ? 'answered' : c.status === 'gated' ? 'gated' : 'missed',
    title: `${c.checkedAt.slice(0, 16).replace('T', ' ')} UTC: ${c.status}`,
  }))
}

export function checkSummary(checks: CheckRecord[]): string {
  if (checks.length === 0) return 'No checks recorded yet'
  const answered = checks.filter((c) => c.status === 'delivered').length
  return `${answered} of the last ${checks.length} checks answered`
}
