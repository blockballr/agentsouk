import { useEffect, useState } from 'react'
import { useActiveAccount } from './use-active-account'
import { watchSession } from './wallet-session'

// Who the page is acting for: the wallet's live account when it has one, and
// otherwise the address this browser signed in with. The two disagree in
// practice, because an extension does not always report accounts back on a
// fresh tab while the session record still stands.
export function useConnectedAccount(): string | null {
  const active = useActiveAccount()
  const [session, setSession] = useState<string | null>(null)
  useEffect(() => watchSession(setSession), [])
  return active ?? session
}
