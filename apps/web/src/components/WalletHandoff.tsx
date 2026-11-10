import { useEffect, useState } from 'react'
import { Btn, Stack, Txt } from './souk'

// The wallet chooser the connect button opens when no extension is present.
// Each entry hands the pairing to the wallet app with the scheme that platform
// understands: an Android intent, or the app scheme on iOS.

type HandoffDetail = { uri: string }

function android(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

function links(uri: string) {
  const encoded = encodeURIComponent(uri)
  return android()
    ? {
        metamask: `intent://wc?uri=${encoded}#Intent;scheme=metamask;package=io.metamask;end`,
        trust: `intent://wc?uri=${encoded}#Intent;scheme=trust;package=com.wallet.crypto.trustapp;end`,
      }
    : {
        metamask: `metamask://wc?uri=${encoded}`,
        trust: `trust://wc?uri=${encoded}`,
      }
}

// the webview clipboard denies permission far too often, so prompt is the floor
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    window.prompt('copy this link:', text)
  }
}

export function WalletHandoff() {
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    const onHandoff = (event: Event) => {
      const detail = (event as CustomEvent<HandoffDetail>).detail
      if (detail?.uri) setUri(detail.uri)
    }
    window.addEventListener('agentsouk:wallet-handoff', onHandoff)
    return () => window.removeEventListener('agentsouk:wallet-handoff', onHandoff)
  }, [])

  if (!uri) return null
  const targets = links(uri)

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <Stack surface pad={[18, 20, 18, 20]} gap={12} className="w-full max-w-[420px]">
        <Txt size={11} lead={14} mono upper tone="data">
          Connect a wallet
        </Txt>
        <Txt size={13} lead={20} tone="slate">
          Pick the wallet you use. It opens with the pairing, and you come back here to sign.
        </Txt>
        <div className="flex flex-col gap-2">
          <Btn
            kind="primary"
            onClick={() => {
              setUri(null)
              window.location.href = targets.metamask
            }}
          >
            MetaMask
          </Btn>
          <Btn
            kind="off"
            onClick={() => {
              setUri(null)
              window.location.href = targets.trust
            }}
          >
            Trust Wallet
          </Btn>
          <Btn kind="off" onClick={() => void copyText(uri)}>
            Copy pairing link
          </Btn>
          <Btn kind="off" onClick={() => setUri(null)}>
            Close
          </Btn>
        </div>
      </Stack>
    </div>
  )
}
