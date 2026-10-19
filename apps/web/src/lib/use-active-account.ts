import { useEffect, useState } from 'react'
import { getActiveAccount, watchActiveAccount } from './wallet'

// the wallet's own active account. read from the provider on mount and re-read
// on focus and on a short poll, because wallet extensions do not always emit
// accountsChanged (or emit it on a provider we are not listening to). this
// reflects who is connected right now; authorization is tracked separately by
// the session layer.
export function useActiveAccount(): string | null {
  const [account, setAccount] = useState<string | null>(null)
  useEffect(() => {
    const sync = () => {
      void getActiveAccount().then(setAccount)
    }
    sync()
    const unwatch = watchActiveAccount(setAccount)
    const onFocus = () => sync()
    const timer = window.setInterval(sync, 2000)
    window.addEventListener('focus', onFocus)
    return () => {
      unwatch()
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  return account
}
