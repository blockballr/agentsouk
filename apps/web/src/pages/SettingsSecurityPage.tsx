import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useActiveAccount } from '../lib/use-active-account'
import { getProvider } from '../lib/wallet'
import { NoteBox, Row, SectionHead, Stack, Txt } from '../components/souk'

const API = import.meta.env.VITE_API_URL ?? '/api'

// A second factor is not a form; it is a switch. Turning it on starts the
// enrolment, turning it off removes the factor, and the switch reflects what the
// server says rather than what the page hoped.
export function SettingsSecurityPage() {
  const wallet = useActiveAccount()
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')

  useEffect(() => {
    if (!wallet) {
      setEnabled(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`${API}/mfa/status?wallet=${wallet}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.success) setEnabled(Boolean(d.totpEnabled))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [wallet])

  function reset() {
    setError(null)
    setNotice(null)
  }

  async function sign(message: string): Promise<string> {
    if (!wallet) throw new Error('Connect a wallet first.')
    const provider = await getProvider()
    return (await provider.request({ method: 'personal_sign', params: [message, wallet] })) as string
  }

  async function enrol() {
    const message = `Enrol authenticator for ${wallet!.toLowerCase()} at ${Date.now()}`
    const signature = await sign(message)
    const res = await fetch(`${API}/mfa/enrol`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, message, signature }),
    })
    const data = await res.json()
    if (!data?.success) throw new Error(data?.error ?? 'Could not start enrolment.')
    setSecret(data.secret)
    setQr(data.qrDataUrl)
  }

  async function disable() {
    const message = `Disable authenticator for ${wallet!.toLowerCase()} at ${Date.now()}`
    const signature = await sign(message)
    const res = await fetch(`${API}/mfa/disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, message, signature }),
    })
    const data = await res.json()
    if (!data?.success) throw new Error(data?.error ?? 'Could not turn it off.')
  }

  async function toggle() {
    if (!wallet || busy) return
    reset()
    setBusy(true)
    try {
      const on = enabled || qr !== null
      if (on) {
        setQr(null)
        setSecret(null)
        setCode('')
        if (enabled) {
          await disable()
          setEnabled(false)
          setNotice('Authenticator turned off.')
        }
      } else {
        await enrol()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    if (!wallet || code.length !== 6 || busy) return
    reset()
    setBusy(true)
    try {
      const message = `Verify authenticator for ${wallet.toLowerCase()} at ${Date.now()}`
      const signature = await sign(message)
      const res = await fetch(`${API}/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, code, message, signature }),
      })
      const data = await res.json()
      if (!data?.success) throw new Error(data?.error ?? 'That code is not valid.')
      setEnabled(true)
      setQr(null)
      setSecret(null)
      setCode('')
      setNotice('Authenticator turned on.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code is not valid.')
    } finally {
      setBusy(false)
    }
  }

  const on = enabled || qr !== null

  return (
    <Stack gap={20} className="mx-auto max-w-[760px] pt-8">
      <Link
        to="/settings"
        className="text-[12px] font-semibold text-souk-muted transition-colors hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        Back to settings
      </Link>
      <SectionHead title="Security" note="MULTIFACTOR" />

      {!wallet ? (
        <NoteBox title="Connect a wallet" copy="Connect your wallet to manage multifactor authentication." />
      ) : (
        <>
          <NoteBox
            title={on ? 'A second factor is on' : 'Off, not enforced yet'}
            copy={
              on
                ? 'This wallet has an authenticator app enrolled. You can turn it off at any time.'
                : 'Agent Souk signs with the wallet itself. Add an authenticator app to require a six-digit code as well.'
            }
          />

          <Stack surface pad={[0, 0, 0, 0]}>
            <Row justify="between" align="center" gap={16} className="px-[20px] py-[18px]">
              <div className="min-w-0">
                <Txt size={13} lead={20} tone="ink">
                  Authenticator app
                </Txt>
                <Txt size={11} lead={17} tone="steel" className="mt-1">
                  {busy ? 'Waiting for your wallet...' : 'Six-digit codes from an app such as Google Authenticator, Authy or 1Password.'}
                </Txt>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label="Authenticator app"
                onClick={toggle}
                disabled={loading || busy}
                className={`relative h-[20px] w-[38px] shrink-0 cursor-pointer rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? 'border-souk-data bg-souk-data' : 'border-souk-hair bg-souk-surface2'
                }`}
              >
                <span
                  className={`absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all duration-150 ${
                    on ? 'left-[20px] bg-souk-canvas' : 'left-[2px] bg-souk-steel'
                  }`}
                />
              </button>
            </Row>
          </Stack>

          {qr && (
            <Stack gap={12} surface pad={[20, 20, 20, 20]}>
              <Txt size={12} lead={18} tone="steel">
                Scan this with your authenticator app, then enter the six-digit code it shows.
              </Txt>
              <img src={qr} alt="TOTP QR code" className="mx-auto h-48 w-48" />
              {secret && (
                <div className="flex items-center gap-2">
                  <Txt size={11} lead={16} mono tone="muted" className="flex-1 text-center break-all">
                    {secret}
                  </Txt>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(secret)}
                    className="shrink-0 rounded-[6px] border border-souk-hair px-2 py-1 text-[10px] font-bold uppercase text-souk-steel transition hover:text-souk-ink"
                  >
                    Copy
                  </button>
                </div>
              )}
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code"
                className="w-full rounded-[8px] border border-souk-hair bg-souk-surface1 px-4 py-3 text-center font-mono text-lg tracking-widest"
              />
              <button
                type="button"
                onClick={verify}
                disabled={busy || code.length !== 6}
                className="rounded-[8px] bg-souk-data px-5 py-3 text-souk-canvas transition hover:brightness-95 disabled:opacity-40"
              >
                {busy ? 'Verifying...' : 'Verify and turn on'}
              </button>
            </Stack>
          )}

          {notice && (
            <Txt size={12} lead={18} tone="ink">
              {notice}
            </Txt>
          )}
          {error && (
            <Txt size={12} lead={18} tone="muted">
              {error}
            </Txt>
          )}
        </>
      )}
    </Stack>
  )
}
