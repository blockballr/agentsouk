import { useEffect, useState } from 'react'
import { watchActiveAccount } from './wallet'

// the wallet's own active account, read from the provider and re-read whenever
// the wallet reports a change. this reflects who is connected right now, even
// before a sign-in record exists for that address, so a wallet switch updates
// every surface that shows the connected account. authorization (which wallet
// the marketplace acts for) is tracked separately by the session layer.
export function useActiveAccount(): string | null {
  const [account, setAccount] = useState<string | null>(null)
  useEffect(() => watchActiveAccount(setAccount), [])
  return account
}
