import { useCallback, useEffect, useState } from 'react'
import { telegramLinkMessage } from '@agora/core'
import { Btn, Stack, Txt } from '../components/souk'
import { beginWalletConnect, connectProvider, signPersonalMessage } from '../lib/wallet'

const BASE = import.meta.env.VITE_TELEGRAM_API ?? 'https://agentsouk-telegram.vercel.app'

type TelegramApp = {
  initData: string
  ready: () => void
  expand: () => void
  openLink?: (url: string) => void
}

function telegramApp(): TelegramApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramApp } }
  return w.Telegram?.WebApp ?? null
}

function telegramIdFrom(initData: string): string | null {
  try {
    const user = JSON.parse(new URLSearchParams(initData).get('user') ?? 'null') as { id?: unknown } | null
    return typeof user?.id === 'number' ? String(user.id) : null
  } catch {
    return null
  }
}

function openWallet(url: string) {
  if (url.startsWith('intent://')) {
    window.location.href = url
    return
  }
  const app = telegramApp()
  if (app?.openLink) app.openLink(url)
  else window.location.href = url
}

// Opened from the bot. Telegram signs initData, the wallet signs one free message,
// and the pair is stored so a settlement can find the chat. No transaction.
export function TelegramLinkPage() {
  const [initData, setInitData] = useState('')
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '')
  const [codeInput, setCodeInput] = useState('')
  const [wallet, setWallet] = useState<string | null>(null)
  const [wcUri, setWcUri] = useState<string | null>(null)
  const [browserLink, setBrowserLink] = useState<string | null>(null)
  const [browserBusy, setBrowserBusy] = useState(false)
  const [linked, setLinked] = useState<string | null>(null)
  const [busy, setBusy] = useState<'connect' | 'sign' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const read = () => {
      const app = telegramApp()
      if (!app) return
      app.ready()
      app.expand()
      setInitData(app.initData)
    }
    if (telegramApp()) {
      read()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-web-app.js'
    script.async = true
    script.onload = read
    document.head.appendChild(script)
    return () => {
      script.onload = null
    }
  }, [])

  const requestBrowserLink = useCallback(async () => {
    if (!initData) return
    setBrowserBusy(true)
    setError(null)
    try {
      const res = await fetch(`${BASE}/telegram/link-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData }),
      })
      const body = (await res.json().catch(() => null)) as { success?: boolean; url?: string; error?: string } | null
      if (!res.ok || !body?.success || !body.url) throw new Error(body?.error ?? 'Could not create a link.')
      setBrowserLink(body.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a link.')
    } finally {
      setBrowserBusy(false)
    }
  }, [initData])

  const connect = useCallback(async () => {
    setBusy('connect')
    setError(null)
    try {
      // a browser with an injected wallet can sign directly; everything else
      // takes the pairing uri and opens the wallet with a universal link,
      // because the custom scheme the modal uses is blocked in some browsers
      const injected = (window as unknown as { ethereum?: unknown }).ethereum
      if (injected) {
        setWallet(await connectProvider())
        return
      }
      const { uri, account } = await beginWalletConnect()
      setWcUri(uri)
      setBusy('sign')
      setWallet(await account)
      setWcUri(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect the wallet.')
      if (initData) void requestBrowserLink()
    } finally {
      setBusy(null)
    }
  }, [initData, requestBrowserLink])

  const link = useCallback(async () => {
    if (!wallet) return
    setBusy('sign')
    setError(null)
    try {
      const telegramId = code ? `code:${code}` : telegramIdFrom(initData)
      if (!telegramId) throw new Error('Open this page from the Agent Souk bot in Telegram.')
      const issued = new Date().toISOString()
      const message = telegramLinkMessage({ telegramId, wallet, issued })
      const signature = await signPersonalMessage(wallet, message)
      const res = await fetch(`${BASE}/telegram/link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(code ? { code } : { initData }),
          wallet,
          signature,
          issued,
        }),
      })
      const body = (await res.json().catch(() => null)) as { success?: boolean; wallet?: string; error?: string } | null
      if (!res.ok || !body?.success) throw new Error(body?.error ?? 'Could not link the wallet.')
      setLinked(body.wallet ?? wallet.toLowerCase())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link the wallet.')
    } finally {
      setBusy(null)
    }
  }, [initData, wallet, code])

  const telegramId = telegramIdFrom(initData)
  const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  const metamaskLink = (uri: string) =>
    android
      ? `intent://wc?uri=${encodeURIComponent(uri)}#Intent;scheme=metamask;package=io.metamask;end`
      : `metamask://wc?uri=${encodeURIComponent(uri)}`
  const trustLink = (uri: string) =>
    android
      ? `intent://wc?uri=${encodeURIComponent(uri)}#Intent;scheme=trust;package=com.wallet.crypto.trustapp;end`
      : `trust://wc?uri=${encodeURIComponent(uri)}`
  const pageUrl = typeof window === 'undefined' ? '' : window.location.href

  return (
    <div className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center px-6 py-12">
      <Stack gap={18}>
        <div>
          <Txt size={11} lead={14} mono upper tone="data">
            Agent Souk
          </Txt>
          <h1 className="mt-3 font-serif text-[34px] font-semibold leading-[40px] tracking-[-0.02em] text-souk-ink">
            Link your wallet.
          </h1>
          <Txt size={14} lead={22} tone="slate" className="mt-3 block">
            One free signature attaches this Telegram account to the wallet you hire with. No transaction,
            no allowance, no custody.
          </Txt>
          <Txt size={13} lead={20} tone="peach" className="mt-4 block">
            Set and Earn only counts the wallet you registered on BNB Chain's campaign form. Hires and
            listings signed by any other wallet cannot count toward your stamps.
          </Txt>
        </div>

        <Stack surface pad={[16, 18, 16, 18]} gap={10}>
          <Txt size={11} lead={14} mono upper tone="muted">
            Telegram
          </Txt>
          <Txt size={13} lead={20} tone={telegramId || code ? 'ink' : 'peach'}>
            {code
              ? `link code ${code}`
              : telegramId
                ? `account ${telegramId}`
                : 'Open this page from the Agent Souk bot in Telegram.'}
          </Txt>
          <a
            href="https://t.me/agentsouk"
            target="_blank"
            rel="noreferrer"
            className="micro text-souk-data underline decoration-souk-hair underline-offset-4 transition hover:text-souk-ink"
          >
            Open the bot at t.me/agentsouk
          </a>
          <Txt size={11} lead={14} mono upper tone="muted" className="mt-2">
            Wallet
          </Txt>
          <Txt size={13} lead={20} mono tone={wallet ? 'ink' : 'slate'}>
            {wallet ?? 'not connected'}
          </Txt>
        </Stack>

        {!code ? (
          <Stack surface pad={[16, 18, 16, 18]} gap={10}>
            <Txt size={11} lead={14} mono upper tone="muted">
              Link code
            </Txt>
            <Txt size={12} lead={18} tone="slate">
              If the bot gave you a code, enter it here.
            </Txt>
            <div className="flex flex-wrap gap-2">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="a94d2223"
                className="h-10 min-w-0 flex-1 border border-souk-hair bg-souk-surface2 px-3 font-mono text-[13px] text-souk-ink outline-none focus:border-souk-data"
              />
              <Btn kind="off" onClick={() => setCode(codeInput.trim())} disabled={!codeInput.trim()}>
                Use code
              </Btn>
            </div>
          </Stack>
        ) : null}

        {linked ? (
          <Stack surface pad={[16, 18, 16, 18]} gap={6}>
            <Txt size={12} lead={16} weight="bold" upper tone="good">
              Linked
            </Txt>
            <Txt size={13} lead={20} mono tone="ink">
              {linked}
            </Txt>
          </Stack>
        ) : (
          <Stack gap={12}>
            <div className="flex flex-wrap gap-3">
              {wallet ? null : (
                <Btn kind="off" onClick={() => void connect()} disabled={busy !== null}>
                  {busy === 'connect' ? 'Opening' : 'Connect wallet'}
                </Btn>
              )}
              <Btn kind="primary" onClick={() => void link()} disabled={busy !== null || (!telegramId && !code) || !wallet}>
                {busy === 'sign' ? 'Waiting for the signature' : 'Sign and link'}
              </Btn>
            </div>

            {wcUri ? (
              <Stack surface pad={[14, 16, 14, 16]} gap={10}>
                <Txt size={12} lead={18} tone="slate">
                  If the wallet app does not open, copy the link and open it in your wallet's browser.
                </Txt>
                <div className="flex flex-wrap gap-3">
                  <Btn kind="primary" onClick={() => openWallet(metamaskLink(wcUri))}>
                    Open MetaMask
                  </Btn>
                  <Btn kind="off" onClick={() => openWallet(trustLink(wcUri))}>
                    Open Trust Wallet
                  </Btn>
                  <Btn kind="off" onClick={() => void navigator.clipboard?.writeText(wcUri)}>
                    Copy link
                  </Btn>
                </div>
              </Stack>
            ) : null}

            {!wallet && !linked && !telegramApp()?.initData ? (
              <Stack surface pad={[14, 16, 14, 16]} gap={10}>
                <Txt size={12} lead={18} tone="slate">
                  Some mobile browsers do not hand the pairing to a wallet app. If the wallet does not
                  open, copy this page link and open it in MetaMask's browser.
                </Txt>
                <div className="flex flex-wrap gap-3">
                  <Btn kind="off" onClick={() => void navigator.clipboard?.writeText(pageUrl)}>
                    Copy page link
                  </Btn>
                </div>
              </Stack>
            ) : null}

            {!code && initData ? (
              <Stack surface pad={[14, 16, 14, 16]} gap={10}>
                <Txt size={12} lead={18} tone="slate">
                  If the wallet app does not open from Telegram, get a link and open it in Safari or
                  Chrome.
                </Txt>
                {browserLink ? (
                  <>
                    <Txt size={11} lead={16} mono tone="ink" className="break-all">
                      {browserLink}
                    </Txt>
                    <div className="flex flex-wrap gap-3">
                      <Btn kind="primary" onClick={() => void navigator.clipboard?.writeText(browserLink)}>
                        Copy link
                      </Btn>
                    </div>
                  </>
                ) : (
                  <Btn kind="off" onClick={() => void requestBrowserLink()} disabled={browserBusy}>
                    {browserBusy ? 'Creating link' : 'Get a browser link'}
                  </Btn>
                )}
              </Stack>
            ) : null}
          </Stack>
        )}

        {error ? (
          <Txt size={12} lead={18} tone="peach">
            {error}
          </Txt>
        ) : null}
      </Stack>
    </div>
  )
}
