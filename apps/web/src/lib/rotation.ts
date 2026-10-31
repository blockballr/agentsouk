// One rotation seed per UTC day, shared by every visitor, so the shelf request
// is a single cacheable URL. The order still changes daily; it no longer changes
// per visit, which is what made every load a cache miss.
const KEY = 'souk.rotation'
const DAY_MS = 24 * 60 * 60 * 1000
const daySeed = Math.floor(Date.now() / DAY_MS).toString(36)

export function visitSeed(): string {
  try {
    const existing = sessionStorage.getItem(KEY)
    if (existing && /^[A-Za-z0-9_-]{1,64}$/.test(existing)) return existing
    sessionStorage.setItem(KEY, daySeed)
  } catch {
    // storage blocked; the day seed still holds for this page load
  }
  return daySeed
}
