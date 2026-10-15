import { useEffect, useState } from 'react'
import { getActiveAccount, watchActiveAccount } from './wallet'

// the wallet's active account: read once on mount and then watched, so a switch
// inside the wallet updates every surface that shows it rather than leaving the
// first address on screen
export function useActiveAccount(): string | null {
  const [account, setAccount] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void getActiveAccount().then((a) => {
      if (live) setAccount(a)
    })
    const unwatch = watchActiveAccount((a) => {
      if (live) setAccount(a)
    })
    return () => {
      live = false
      unwatch()
    }
  }, [])
  return account
}
