import { useCallback, useEffect, useState } from 'react'
import { telegramLinkMessage } from '@agora/core'
import { Btn, Stack, Txt } from '../components/souk'
import { connectProvider, signPersonalMessage } from '../lib/wallet'

const BASE = import.meta.env.VITE_TELEGRAM_API ?? 'https://telegram.agentsouk.xyz'

type TelegramApp = { initData: string; ready: () => void; expand: () => void }

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

// Opened from the bot. Telegram signs initData, the wallet signs one free message,
// and the pair is stored so a settlement can find the chat. No transaction.
export function TelegramLinkPage() {
  const [initData, setInitData] = useState('')
  const [wallet, setWallet] = useState<string | null>(null)
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

  const connect = useCallback(async () => {
    setBusy('connect')
    setError(null)
    try {
      setWallet(await connectProvider())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect the wallet.')
    } finally {
      setBusy(null)
    }
  }, [])

  const link = useCallback(async () => {
    setBusy('sign')
    setError(null)
    try {
      const telegramId = telegramIdFrom(initData)
      if (!telegramId) throw new Error('Open this page from the Agent Souk bot in Telegram.')
      const account = wallet ?? (await connectProvider())
      setWallet(account)
      const message = telegramLinkMessage({ telegramId, wallet: account })
      const signature = await signPersonalMessage(account, message)
      const res = await fetch(`${BASE}/telegram/link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData, wallet: account, signature }),
      })
      const body = (await res.json().catch(() => null)) as { success?: boolean; wallet?: string; error?: string } | null
      if (!res.ok || !body?.success) throw new Error(body?.error ?? 'Could not link the wallet.')
      setLinked(body.wallet ?? account.toLowerCase())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link the wallet.')
    } finally {
      setBusy(null)
    }
  }, [initData, wallet])

  const telegramId = telegramIdFrom(initData)

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
        </div>

        <Stack surface pad={[16, 18, 16, 18]} gap={10}>
          <Txt size={11} lead={14} mono upper tone="muted">
            Telegram
          </Txt>
          <Txt size={13} lead={20} tone={telegramId ? 'ink' : 'peach'}>
            {telegramId ? `account ${telegramId}` : 'Open this page from the Agent Souk bot in Telegram.'}
          </Txt>
          <Txt size={11} lead={14} mono upper tone="muted" className="mt-2">
            Wallet
          </Txt>
          <Txt size={13} lead={20} mono tone={wallet ? 'ink' : 'slate'}>
            {wallet ?? 'not connected'}
          </Txt>
        </Stack>

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
          <div className="flex flex-wrap gap-3">
            {wallet ? null : (
              <Btn kind="off" onClick={() => void connect()} disabled={busy !== null}>
                {busy === 'connect' ? 'Connecting' : 'Connect wallet'}
              </Btn>
            )}
            <Btn kind="primary" onClick={() => void link()} disabled={busy !== null || !telegramId}>
              {busy === 'sign' ? 'Waiting for the signature' : 'Sign and link'}
            </Btn>
          </div>
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
