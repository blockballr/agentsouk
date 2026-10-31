// A rotation seed shared by every visit in the same five minute window, so the
// shelf request is the same URL and the edge can serve it from cache. Paging
// within a tab keeps one seed, so the order does not shift under the reader.
const KEY = 'souk.rotation'
const BUCKET_MS = 5 * 60_000
const bucketSeed = Math.floor(Date.now() / BUCKET_MS).toString(36)

export function visitSeed(): string {
  try {
    const existing = sessionStorage.getItem(KEY)
    if (existing && /^[A-Za-z0-9_-]{1,64}$/.test(existing)) return existing
    sessionStorage.setItem(KEY, bucketSeed)
  } catch {
    // storage blocked; the bucket seed still holds for this page load
  }
  return bucketSeed
}
