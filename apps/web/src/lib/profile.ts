// The profile picture and username are per wallet and per browser for now: the
// account service has no profile record yet, so the shell stores them locally
// and the navbar chip reads the same record. One key, one event, one read.
import { useEffect, useState } from 'react'

export interface StoredProfile {
  username: string
  /** a data URL, kept small enough for local storage */
  avatar: string
}

const KEY = 'agentsouk.profile'
const EVENT = 'agentsouk.profile'

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
  window.localStorage.setItem(KEY, JSON.stringify(all))
  // the chip in the navbar is a sibling, not a child: tell it to re-read
  window.dispatchEvent(new Event(EVENT))
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
    return subscribe(read)
  }, [address])
  return profile
}
