import { useEffect, useState } from 'react'
import { watchSession } from './wallet-session'

// the wallet's signed-in address: the session established by a signature,
// read once on mount and then watched, so a switch inside the wallet adopts a
// recorded address or disconnects instead of changing who the page thinks you
// are
export function useActiveAccount(): string | null {
  const [account, setAccount] = useState<string | null>(null)
  useEffect(() => watchSession(setAccount), [])
  return account
}
