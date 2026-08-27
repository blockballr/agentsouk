// compare shortlist persisted locally, keyed as chainId/tokenId
const KEY = 'agora.compare.ids'

export function getShortlist(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function setShortlist(ids: string[]) {
  localStorage.setItem(KEY, JSON.stringify(ids))
}

export function toggleShortlist(id: string): string[] {
  const current = getShortlist()
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id]
  setShortlist(next)
  return next
}