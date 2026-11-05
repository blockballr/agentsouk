import { useEffect, useState } from 'react'
import { watchSession } from './wallet-session'

// Who the page is acting for: the address this browser signed in with, never
// whatever the wallet happens to expose. An extension can keep answering
// eth_accounts after a disconnect, and a switch to an address with no record
// must read as disconnected instead of becoming the new identity.
export function useConnectedAccount(): string | null {
  const [session, setSession] = useState<string | null>(null)
  useEffect(() => watchSession(setSession), [])
  return session
}
