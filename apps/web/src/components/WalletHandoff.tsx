import { useEffect, useState } from 'react'
import { Btn, Stack, Txt } from './souk'

// The wallet chooser the connect button opens when no extension is present.
// Each entry hands the pairing to the wallet app with the scheme that platform
// understands: an Android intent, or the app scheme on iOS. Inside the Telegram
// webview that handshake cannot finish on real devices, so the sheet also
// carries an escape: the bot's link-code page, opened in a real browser tab.

type HandoffDetail = { uri: string }

const TELEGRAM_API = import.meta.env.VITE_TELEGRAM_API ?? 'https://agentsouk-telegram.vercel.app'
const TELEGRAM_LINK = 'https://app.agentsouk.xyz/telegram/link'
const TELEGRAM_PLATFORMS = new Set(['android', 'ios', 'macos', 'tdesktop'])

type TelegramApp = { platform?: string; initData?: string }

function telegramApp(): TelegramApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramApp } }
  return w.Telegram?.WebApp ?? null
}

function inTelegram(): boolean {
  const app = telegramApp()
  if (!app) return false
  return Boolean(app.initData) || TELEGRAM_PLATFORMS.has(app.platform ?? '')
}

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

// asks the telegram bot for a signed link page, then hands it to the browser
// outside telegram. if the bot is unreachable, the plain link page opens.
async function requestWalletLink(): Promise<{ url: string; note?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}/telegram/link-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: telegramApp()?.initData ?? '' }),
    })
    const body = (await res.json().catch(() => null)) as { success?: boolean; url?: string } | null
    if (!res.ok || !body?.success || !body.url) throw new Error('no link')
    return { url: body.url }
  } catch {
    return { url: TELEGRAM_LINK, note: 'no fresh link came back, so the plain wallet page opened instead.' }
  }
}

export function WalletHandoff() {
  const [uri, setUri] = useState<string | null>(null)
  const [walletUrl, setWalletUrl] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const escape = uri && inTelegram()

  useEffect(() => {
    const onHandoff = (event: Event) => {
      const detail = (event as CustomEvent<HandoffDetail>).detail
      if (detail?.uri) setUri(detail.uri)
    }
    window.addEventListener('agentsouk:wallet-handoff', onHandoff)
    return () => window.removeEventListener('agentsouk:wallet-handoff', onHandoff)
  }, [])

  const openWalletBrowser = async () => {
    setBusy(true)
    setNote(null)
    const out = await requestWalletLink()
    setWalletUrl(out.url)
    if (out.note) setNote(out.note)
    window.open(out.url, '_blank')
    setBusy(false)
  }

  if (!uri) return null
  const targets = links(uri)

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <Stack surface pad={[18, 20, 18, 20]} gap={12} className="w-full max-w-[420px]">
        <Txt size={11} lead={14} mono upper tone="data">
          Connect a wallet
        </Txt>
        {escape && (
          <div className="flex flex-col gap-2 border border-souk-hair p-3">
            <Txt size={13} lead={20} tone="slate">
              the handshake cannot finish inside telegram on this device. the pairing lives outside
              telegram: open the wallet page in a real browser tab and connect there.
            </Txt>
            <Btn kind="primary" disabled={busy} onClick={() => void openWalletBrowser()}>
              Wallet browser
            </Btn>
            {busy && (
              <Txt size={12} lead={16} tone="slate">
                creating your wallet link
              </Txt>
            )}
            {note && (
              <Txt size={12} lead={16} tone="peach">
                {note}
              </Txt>
            )}
            {walletUrl && (
              <div className="flex items-stretch gap-1">
                <div className="min-w-0 flex-1 overflow-hidden border border-souk-hair py-2">
                  <Txt size={11} lead={14} mono tone="slate" className="block truncate px-2">
                    {walletUrl}
                  </Txt>
                </div>
                <Btn kind="off" onClick={() => void copyText(walletUrl)}>
                  Copy
                </Btn>
              </div>
            )}
            <Btn kind="off" onClick={() => void copyText(window.location.href)}>
              Copy this link
            </Btn>
          </div>
        )}
        <Txt size={13} lead={20} tone="slate">
          Pick the wallet you use. It opens with the pairing, and you come back here to sign.
        </Txt>
        <div className="flex flex-col gap-2">
          <Btn
            kind={escape ? 'off' : 'primary'}
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
