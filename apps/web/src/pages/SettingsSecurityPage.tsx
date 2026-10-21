import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useActiveAccount } from '../lib/use-active-account'
import { getProvider } from '../lib/wallet'
import { NoteBox, SectionHead, Stack, Txt } from '../components/souk'

const API = import.meta.env.VITE_API_URL ?? '/api'

export function SettingsSecurityPage() {
  const wallet = useActiveAccount()
  const [enrolled, setEnrolled] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function enrol() {
    if (!wallet) return
    setBusy(true)
    setError(null)
    try {
      const message = `Enrol MFA for ${wallet.toLowerCase()} at ${Date.now()}`
      const provider = await getProvider()
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, wallet],
      })
      const res = await fetch(`${API}/mfa/enrol`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, message, signature }),
      })
      const data = await res.json()
      if (!data?.success) throw new Error(data?.error ?? 'enrol failed')
      setSecret(data.secret)
      setQr(data.qrDataUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'enrol failed')
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    if (!wallet || !code) return
    setBusy(true)
    setError(null)
    try {
      const message = `Verify MFA for ${wallet.toLowerCase()} at ${Date.now()}`
      const provider = await getProvider()
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, wallet],
      })
      const res = await fetch(`${API}/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, code, message, signature }),
      })
      const data = await res.json()
      if (!data?.success) throw new Error(data?.error ?? 'invalid code')
      setSuccess(true)
      setEnrolled(true)
      setQr(null)
      setSecret(null)
      setCode('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'invalid code')
    } finally {
      setBusy(false)
    }
  }

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
            title={enrolled ? 'Enabled' : 'Off, not enforced yet'}
            copy={
              enrolled
                ? 'A second factor is enrolled for this wallet. Codes are verified on every sensitive action.'
                : 'Agent Souk signs with the wallet itself. Enrol an authenticator app to add a second factor.'
            }
          />

          {!enrolled && !qr && (
            <button
              type="button"
              onClick={enrol}
              disabled={busy}
              className="rounded-[8px] bg-souk-data px-5 py-3 text-souk-canvas transition hover:brightness-95 disabled:opacity-40"
            >
              {busy ? 'Enrolling...' : 'Enrol authenticator app'}
            </button>
          )}

          {qr && (
            <Stack gap={12} surface pad={[20, 20, 20, 20]}>
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
                onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code"
                className="w-full rounded-[8px] border border-souk-hair bg-souk-surface1 px-4 py-3 text-center font-mono text-lg tracking-widest"
              />
              <button
                type="button"
                onClick={verify}
                disabled={busy || code.length !== 6}
                className="rounded-[8px] bg-souk-data px-5 py-3 text-souk-canvas transition hover:brightness-95 disabled:opacity-40"
              >
                {busy ? 'Verifying...' : 'Verify and enable'}
              </button>
              {error && <Txt size={12} lead={18} tone="muted">{error}</Txt>}
            </Stack>
          )}

          {success && (
            <Txt size={12} lead={18} tone="ink">
              Multifactor authentication enabled.
            </Txt>
          )}
        </>
      )}
    </Stack>
  )
}
