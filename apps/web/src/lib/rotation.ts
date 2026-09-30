// one seed per visit, so "Working first" keeps the same order while a tab pages through it,
// and a new visit sees the working agents in a different order
const KEY = 'souk.rotation'
const pageSeed = Math.random().toString(36).slice(2, 12)

export function visitSeed(): string {
  try {
    const existing = sessionStorage.getItem(KEY)
    if (existing && /^[A-Za-z0-9_-]{1,64}$/.test(existing)) return existing
    sessionStorage.setItem(KEY, pageSeed)
  } catch {
    // storage blocked; the seed still holds for this page load
  }
  return pageSeed
}
