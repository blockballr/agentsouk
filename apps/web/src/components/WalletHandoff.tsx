import { useEffect, useRef, useState } from 'react'
import { Btn, Stack, Txt } from './souk'

// The wallet chooser the connect button opens when no extension is present.
// Each entry hands the pairing to the wallet app with the scheme that platform
// understands: an Android intent, or the app scheme on iOS.
//
// The sheet is a native modal dialog, so the browser owns the top layer, focus
// containment, Escape and the backdrop instead of a hand-rolled overlay.

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
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (uri && !dialog.open) dialog.showModal()
    if (!uri && dialog.open) dialog.close()
  }, [uri])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const onClose = () => setUri(null)
    dialog.addEventListener('close', onClose)

    // Safari does not support closedby yet. In that case, close on a press and
    // release that both land outside the dialog, so a text selection that ends
    // on the backdrop does not dismiss it.
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false
      const outside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect()
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
      }
      const down = (e: PointerEvent) => {
        pressedOutside = outside(e)
      }
      const up = (e: PointerEvent) => {
        if (pressedOutside && outside(e)) dialog.close()
      }
      dialog.addEventListener('pointerdown', down)
      dialog.addEventListener('pointerup', up)
      return () => {
        dialog.removeEventListener('close', onClose)
        dialog.removeEventListener('pointerdown', down)
        dialog.removeEventListener('pointerup', up)
      }
    }

    return () => dialog.removeEventListener('close', onClose)
  }, [])

  useEffect(() => {
    const onHandoff = (event: Event) => {
      const detail = (event as CustomEvent<HandoffDetail>).detail
      if (detail?.uri) setUri(detail.uri)
    }
    window.addEventListener('agentsouk:wallet-handoff', onHandoff)
    return () => window.removeEventListener('agentsouk:wallet-handoff', onHandoff)
  }, [])

  const targets = uri ? links(uri) : null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="wallet-handoff-title"
      className="souk-wallet-dialog"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <Stack surface pad={[18, 20, 18, 20]} gap={12} className="w-full">
        <h2
          id="wallet-handoff-title"
          className="font-mono text-[11px] font-semibold uppercase leading-[14px] text-souk-data"
        >
          Connect a wallet
        </h2>
        <Txt size={13} lead={20} tone="slate">
          Pick the wallet you use. It opens with the pairing, and you come back here to sign.
        </Txt>
        <div className="flex flex-col gap-2">
          <Btn
            kind="primary"
            onClick={() => {
              if (!targets) return
              setUri(null)
              window.location.href = targets.metamask
            }}
          >
            MetaMask
          </Btn>
          <Btn
            kind="off"
            onClick={() => {
              if (!targets) return
              setUri(null)
              window.location.href = targets.trust
            }}
          >
            Trust Wallet
          </Btn>
          <Btn kind="off" onClick={() => (uri ? void copyText(uri) : undefined)}>
            Copy pairing link
          </Btn>
          <Btn kind="off" onClick={() => dialogRef.current?.close()}>
            Close
          </Btn>
        </div>
      </Stack>
    </dialog>
  )
}
