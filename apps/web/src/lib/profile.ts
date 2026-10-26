// Profile (username + avatar) for a wallet. Stored server-side when the API is
// available so it survives device and browser changes; localStorage is the
// fallback when the store is offline, so nothing is lost in the meantime.
import { useEffect, useState } from 'react'

export interface StoredProfile {
  username: string
  /** a data URL, kept small enough for local storage */
  avatar: string
}

const KEY = 'agentsouk.profile'
const EVENT = 'agentsouk.profile'
const BASE = import.meta.env.VITE_API_URL ?? '/api'

type Book = Record<string, StoredProfile>

function readAll(): Book {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Book) : {}
  } catch {
    return {}
  }
}

export function readProfile(address: string | null | undefined): StoredProfile | null {
  if (!address) return null
  const entry = readAll()[address.toLowerCase()]
  if (!entry) return null
  return entry.username || entry.avatar ? entry : null
}

export function saveProfile(address: string, profile: StoredProfile): void {
  const all = readAll()
  all[address.toLowerCase()] = profile
  try { window.localStorage.setItem(KEY, JSON.stringify(all)) } catch {}
  window.dispatchEvent(new Event(EVENT))
  // also persist server-side, best effort
  fetch(`${BASE}/profiles/${address}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: profile.username, avatar: profile.avatar }),
  }).catch(() => {})
}

// async read from the server; falls back to localStorage
export async function readProfileAsync(address: string | null | undefined): Promise<StoredProfile | null> {
  if (!address) return readProfile(address)
  try {
    const res = await fetch(`${BASE}/profiles/${address}`)
    if (res.ok) {
      const body = await res.json().catch(() => null)
      const p = body?.profile
      if (p && (p.username || p.avatar)) {
        const profile: StoredProfile = { username: p.username ?? '', avatar: p.avatar ?? '' }
        const all = readAll()
        all[address.toLowerCase()] = profile
        try { window.localStorage.setItem(KEY, JSON.stringify(all)) } catch {}
        return profile
      }
    }
  } catch {
    // fall through to local
  }
  return readProfile(address)
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useLocalProfile(address: string | null | undefined): StoredProfile | null {
  const [profile, setProfile] = useState<StoredProfile | null>(() => readProfile(address))
  useEffect(() => {
    const read = () => setProfile(readProfile(address))
    read()
    readProfileAsync(address).then((p) => { if (p) setProfile(p) }).catch(() => {})
    return subscribe(read)
  }, [address])
  return profile
}