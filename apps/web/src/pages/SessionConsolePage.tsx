import { useState } from 'react'
import { Btn, Pill, Stack, Txt } from '../components/souk'
import { consoleMessage, type ConsoleAction } from '../lib/session-console'
import { useConnectedAccount } from '../lib/use-connected-account'
import { useTargetChain } from '../lib/target-chain'
import { getProvider } from '../lib/wallet'
import { walletErrorText } from '../lib/wallet-errors'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface SessionRow {
  tokenId: string
  label: string
  walletAddress: string
  expiry: number | null
  expiresInDays: number | null
  signatures: string[]
  targets: string[]
  unrestricted: boolean
  stale: boolean
  revokedAt: string | null
  canAct: boolean
  grantedAt: string
  bnb: string | null
}

function shortAddress(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}

function statusOf(s: SessionRow): { label: string; variant: 'good' | 'warn' | 'off' } {
  if (s.revokedAt) return { label: 'Revoked', variant: 'off' }
  if (s.stale) return { label: 'Cannot reach the live vault', variant: 'warn' }
  if (s.expiresInDays !== null && s.expiresInDays <= 0) return { label: 'Expired', variant: 'warn' }
  if (s.expiresInDays !== null && s.expiresInDays <= 7) return { label: `Expires in ${s.expiresInDays} days`, variant: 'warn' }
  return { label: 'Active', variant: 'good' }
}

// the team's view of every executor session: what each may call, until when, and
// the three things an operator does with one. each action is signed by a team
// wallet, and the server acts with the admin key it holds
export function SessionConsolePage() {
  const account = useConnectedAccount()
  const target = useTargetChain()
  const chainId = target?.chainId ?? 56
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  async function signed(action: ConsoleAction, tokenId: string | null) {
    if (!account) throw new Error('Connect a team wallet first.')
    const at = Date.now()
    const message = consoleMessage(action, chainId, tokenId, account, at)
    const provider = await getProvider()
    const signature = (await provider.request({ method: 'personal_sign', params: [message, account] })) as string
    const res = await fetch(`${API_BASE}/vault/sessions/console`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, chainId, tokenId, wallet: account, signature, at }),
    })
    const body = await res.json().catch(() => null)
    if (!body?.success) throw new Error(body?.error ?? `the console answered ${res.status}`)
    return body
  }

  async function load() {
    setBusy('list')
    setNote(null)
    try {
      const body = await signed('list', null)
      setSessions(body.sessions as SessionRow[])
    } catch (e) {
      setNote(e instanceof Error && !/user|reject|declin/i.test(e.message) ? e.message : walletErrorText(e))
    } finally {
      setBusy(null)
    }
  }

  async function act(action: Exclude<ConsoleAction, 'list'>, tokenId: string) {
    setBusy(`${action}:${tokenId}`)
    setNote(null)
    setConfirming(null)
    try {
      const body = await signed(action, tokenId)
      setNote(
        action === 'revoke'
          ? `Agent ${tokenId}'s session is revoked on chain${body.txHash ? ` (${String(body.txHash).slice(0, 10)}...)` : ''}. It stops trading until you grant it again.`
          : `Agent ${tokenId} has a fresh 30 day session.`,
      )
      const list = await signed('list', null)
      setSessions(list.sessions as SessionRow[])
    } catch (e) {
      setNote(e instanceof Error && !/user|reject|declin/i.test(e.message) ? e.message : walletErrorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="min-h-screen bg-souk-canvas pb-24 pt-8 text-souk-ink">
      <Stack gap={8}>
        <Txt size={11} lead={16} mono upper tone="data">
          account, executor sessions
        </Txt>
        <Txt size={34} lead={42} display weight="bold" tone="ink">
          Executor sessions.
        </Txt>
        <Txt size={15} lead={23} tone="slate" className="block max-w-[68ch]">
          Each vault agent trades through a session: a permission on its executor wallet that names the vault functions it
          may call, caps what it spends each day, and lapses after 30 days. Renew one early, revoke one at once, or grant a
          revoked one again. Only a team wallet can open this page, and you sign every action.
        </Txt>
      </Stack>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Btn kind="primary" disabled={!account || busy !== null} onClick={() => void load()}>
          {busy === 'list' ? 'Reading' : sessions ? 'Read again' : 'Sign and read the sessions'}
        </Btn>
        {!account ? (
          <Txt size={13} lead={20} tone="steel">
            Connect a team wallet first.
          </Txt>
        ) : null}
      </div>
      <div role="status" className="mt-3 max-w-[70ch]">
        {note ? (
          <Txt size={13} lead={20} tone="slate">
            {note}
          </Txt>
        ) : null}
      </div>

      {sessions ? (
        sessions.length === 0 ? (
          <Txt size={14} lead={21} tone="slate" className="mt-8 block">
            No sessions are stored for chain {chainId}.
          </Txt>
        ) : (
          <ul className="mt-8 grid gap-3">
            {sessions.map((s) => {
              const status = statusOf(s)
              const rowBusy = busy !== null && busy.endsWith(`:${s.tokenId}`)
              return (
                <li key={s.tokenId} className="rounded-[14px] border border-souk-hair p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Txt size={16} lead={22} weight="bold" tone="ink">
                        {s.label} <span className="font-mono text-[12px] text-souk-labels">#{s.tokenId}</span>
                      </Txt>
                      <Txt size={12} lead={18} mono tone="steel" className="mt-1 block">
                        executor {shortAddress(s.walletAddress)}
                        {s.expiry ? `, until ${new Date(s.expiry * 1000).toLocaleDateString()}` : ''}
                        {s.bnb !== null ? `, holds ${Number(s.bnb).toFixed(4)} BNB for fees` : ''}
                      </Txt>
                    </div>
                    <Pill variant={status.variant}>{status.label}</Pill>
                  </div>
                  <Txt size={12} lead={18} tone="slate" className="mt-3 block">
                    {s.unrestricted
                      ? 'May call anything on the wallet. Grant it again to narrow it to the vault functions.'
                      : `May call ${s.signatures.map((sig) => sig.split('(')[0]).join(', ') || s.targets.map(shortAddress).join(', ')}.`}
                  </Txt>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!s.canAct ? (
                      <Txt size={12} lead={18} tone="steel">
                        No admin key is stored for this wallet, so it is managed by script only.
                      </Txt>
                    ) : s.revokedAt ? (
                      <Btn kind="primary" disabled={busy !== null} onClick={() => void act('regrant', s.tokenId)}>
                        {rowBusy ? 'Granting' : 'Grant again'}
                      </Btn>
                    ) : confirming === s.tokenId ? (
                      <>
                        <Txt size={12} lead={18} tone="ink">
                          Revoke now? The agent stops trading until the session is granted again.
                        </Txt>
                        <Btn kind="primary" disabled={busy !== null} onClick={() => void act('revoke', s.tokenId)}>
                          {rowBusy ? 'Revoking' : 'Yes, revoke'}
                        </Btn>
                        <Btn kind="off" disabled={busy !== null} onClick={() => setConfirming(null)}>
                          Keep it
                        </Btn>
                      </>
                    ) : (
                      <>
                        <Btn kind="off" disabled={busy !== null} onClick={() => void act('renew', s.tokenId)}>
                          {rowBusy ? 'Renewing' : 'Renew now'}
                        </Btn>
                        <Btn kind="off" disabled={busy !== null} onClick={() => setConfirming(s.tokenId)}>
                          Revoke
                        </Btn>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )
      ) : null}
    </section>
  )
}
