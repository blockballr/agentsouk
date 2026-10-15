import { useCallback, useEffect, useState } from 'react'
import { shortAddress, timeAgo, timeUntil } from '@agora/core'
import {
  changeMemberRole,
  stationMembers,
  stationOperations,
  stationSignIn,
  stationSignOut,
  type AuditEntry,
  type StationMember,
  type StationOperations,
  type StationRole,
  type StationSession,
} from '../lib/station'
import { Btn, Dot, Pill, Row, Rule, SectionHead, Stack, Txt } from '../components/souk'
import { DataTable } from '../components/souk'

const TOKEN_KEY = 'agentsouk.station.token'

// the design's three roles, kept in the order the drawing lists them
const ROLE_ORDER: StationRole[] = ['viewer', 'operator', 'owner']

const ROLE_BOX: Record<StationRole, { rows: [string, string][]; copy: string }> = {
  viewer: {
    rows: [
      ['Reads every board', 'yes'],
      ['Runs a re-check', 'no'],
      ['Buys a boost', 'no'],
      ['Unlists a stall', 'no'],
      ['Probes a listing', 'no'],
    ],
    copy: 'For the people who watch the market without touching it.',
  },
  operator: {
    rows: [
      ['Reads every board', 'yes'],
      ['Runs a re-check', 'yes'],
      ['Buys a boost', 'yes, from the vault'],
      ['Unlists a stall', 'asks the owner'],
      ['Probes a listing', 'yes'],
    ],
    copy: 'The day to day hands. Everything they do is signed.',
  },
  owner: {
    rows: [
      ['Reads every board', 'yes'],
      ['Runs a re-check', 'yes'],
      ['Buys a boost', 'yes'],
      ['Unlists a stall', 'yes'],
      ['Probes a listing', 'yes'],
    ],
    copy: 'The wallet that registered the stalls. One per station, and it is not handed over in the UI.',
  },
}

// a live session counts down and a spent one reads as history, so the two take
// different verbs: "expires in 12h" and "expired 2h ago" are both true statements
function sessionNotice(expiresAt: string): string {
  const left = Date.parse(expiresAt) - Date.now()
  const tail = ' A new signature starts a new one, and the old nonce stops working the moment it lands.'
  if (!Number.isFinite(left)) return `Your session state is unreadable.${tail}`
  if (left <= 0) return `Your session expired ${timeAgo(expiresAt)}.${tail}`
  return `Your session expires ${timeUntil(expiresAt)}.${tail}`
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable; the session still holds for this page
  }
}

// the team's room: a wallet signs a nonce to open a session, and every change below
// is signed against a nonce of its own, so the ledger records who did what
export function StationPage() {
  const [session, setSession] = useState<StationSession | null>(null)
  const [members, setMembers] = useState<StationMember[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [ops, setOps] = useState<StationOperations | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (token: string) => {
    const [list, operations] = await Promise.all([
      stationMembers(token),
      stationOperations(token).catch(() => null),
    ])
    setMembers(list.members)
    setAudit(list.audit)
    if (operations) setOps(operations.operations)
  }, [])

  useEffect(() => {
    const token = readToken()
    if (!token) return
    setSession({ token, address: '', role: 'viewer', expiresAt: '' })
    load(token).catch((e) => {
      // a session that the server no longer holds is not an error the page can fix
      writeToken(null)
      setSession(null)
      setError((e as Error).message)
    })
  }, [load])

  async function onSignIn() {
    setBusy(true)
    setError(null)
    try {
      const opened = await stationSignIn()
      writeToken(opened.token)
      setSession(opened)
      await load(opened.token)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onSignOut() {
    if (session) await stationSignOut(session.token)
    writeToken(null)
    setSession(null)
    setMembers([])
    setAudit([])
    setOps(null)
  }

  async function onChange(target: string, change: StationRole | 'remove') {
    if (!session?.address) return
    setBusy(true)
    setError(null)
    try {
      const out = await changeMemberRole(session.token, session.address, target, change)
      setMembers(out.members)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const owner = session?.role === 'owner'
  const signedIn = Boolean(session?.token)

  return (
    <div className="min-h-screen bg-souk-canvas px-4 lg:px-8 pb-[240px] pt-10 text-souk-ink xl:pb-28">
      {/* the hero names the room and says what signs it */}
      <Stack gap={10} pad={[32, 0, 0, 0]} className="xl:max-w-[calc(100%_-_460px)]">
        <Txt size={11} lead={16} mono upper tone="data">
          {`Station · station.agentsouk.xyz · ${members.length} member${members.length === 1 ? '' : 's'}`}
        </Txt>
        <Txt size={34} lead={42} weight="bold" tone="ink">
          Your team&apos;s own room.
        </Txt>
        <Txt size={15} lead={23} tone="slate" className="block max-w-[1180px]">
          Members sign in with a wallet, so nothing is handed out as a password and every action
          lands in the ledger below against the wallet that took it.
        </Txt>
      </Stack>

      {error ? (
        <div className="mt-6 rounded-[10px] border border-souk-peach/45 p-4" role="note">
          <Txt size={13} lead={20} tone="peach">
            {error}
          </Txt>
        </div>
      ) : null}

      {!signedIn ? (
        <Stack surface pad={[20, 22, 20, 22]} gap={14} className="mt-6">
          <SectionHead title="Sign in" note="A WALLET, NOT A PASSWORD" />
          <Txt size={13} lead={20} tone="slate">
            The station only answers a wallet the owner has already added. Sign in with one, and the
            station issues a nonce, signs it, and opens a session against it.
          </Txt>
          <Btn kind="primary" className="w-fit" disabled={busy} onClick={() => void onSignIn()}>
            {busy ? 'Waiting for signature..' : 'Sign in with a wallet'}
          </Btn>
        </Stack>
      ) : (
        <>
          {/* the members: one row per wallet, its role, and the change the owner can
              make on it */}
          <Stack gap={12} pad={[24, 0, 0, 0]}>
            <SectionHead
              title={`${members.length} member${members.length === 1 ? '' : 's'}`}
              note="VIEWER, OPERATOR, OWNER"
            />
            <DataTable
              cols={[430, 260, 366, 380]}
              header={['Wallet', 'Role', 'Session', 'Change']}
              rows={members.map((m) => ({
                height: 40,
                cells: [
                  { text: shortAddress(m.address), mono: true, size: 13, tone: 'ink' },
                  { text: m.role, size: 13, weight: 'semibold', tone: 'ink' },
                  {
                    text: m.address.toLowerCase() === session?.address.toLowerCase() ? 'this session' : 'none',
                    size: 13,
                    tone: m.address.toLowerCase() === session?.address.toLowerCase() ? 'data' : 'muted',
                  },
                  {
                    text: owner
                      ? m.address.toLowerCase() === session?.address.toLowerCase()
                        ? 'this session'
                        : 'remove'
                      : 'none',
                    size: 13,
                    weight: owner ? 'semibold' : 'regular',
                    tone: owner ? 'slate' : 'muted',
                  },
                ],
              }))}
            />
            {owner ? (
              <Txt size={12} lead={18} tone="muted">
                Removing a wallet signs against a nonce of its own, so the change cannot be replayed
                against a different one.
              </Txt>
            ) : null}
          </Stack>

          {/* access is the owner's own panel: a wallet joins, and the change signs
              a nonce rather than borrowing the session's */}
          {owner ? (
            <Stack gap={12} pad={[20, 0, 0, 0]}>
              <SectionHead title="Change access" note="GRANT AND REVOKE" />
              <ChangeAccess
                busy={busy}
                members={members}
                onChange={(target, change) => void onChange(target, change)}
              />
            </Stack>
          ) : null}

          {/* the three roles, each with what it can and cannot do */}
          <Stack gap={12} pad={[20, 0, 0, 0]}>
            <SectionHead title="What each role can do" />
            <div className="grid gap-5 md:grid-cols-3">
              {ROLE_ORDER.map((role) => (
                <Stack key={role} gap={10} radius={14} hair pad={[14, 16, 14, 16]}>
                  <Txt size={13} lead={20} weight="bold" tone="ink">
                    {role}
                  </Txt>
                  <Txt size={12} lead={18} tone="steel">
                    {ROLE_BOX[role].copy}
                  </Txt>
                  <Rule />
                  {ROLE_BOX[role].rows.map(([what, can]) => (
                    <Row key={what} justify="between" align="center" gap={12}>
                      <Txt size={12} lead={18} tone="slate">
                        {what}
                      </Txt>
                      <Txt size={12} lead={18} tone={can === 'no' ? 'muted' : 'data'}>
                        {can}
                      </Txt>
                    </Row>
                  ))}
                </Stack>
              ))}
            </div>
          </Stack>

          {/* what the deployment is running, read from the cron and relay state */}
          {ops ? (
            <Stack gap={12} pad={[20, 0, 0, 0]}>
              <SectionHead title="What is running" note="THE CRON, AS IT LAST ANSWERED" />
              <DataTable
                cols={[420, 300, 300, 300]}
                header={['Job', 'Last run', 'Result', 'Note']}
                rows={ops.jobs.map((j) => ({
                  height: 34,
                  cells: [
                    { text: j.name, size: 13, tone: 'ink' },
                    {
                      text: j.finishedAt ? timeAgo(j.finishedAt) : 'never',
                      mono: true,
                      size: 12,
                      tone: j.finishedAt ? 'slate' : 'muted',
                    },
                    {
                      text: j.ok === null ? 'not run' : j.ok ? 'ok' : 'failed',
                      size: 12,
                      tone: j.ok === null ? 'muted' : j.ok ? 'data' : 'peach',
                    },
                    { text: j.note ?? 'none', size: 12, tone: 'steel' },
                  ],
                }))}
              />
            </Stack>
          ) : null}

          {/* the ledger: every signed action, newest first */}
          <Stack gap={12} pad={[20, 0, 0, 0]}>
            <SectionHead title="The ledger" note="EVERY ACTION, SIGNED" />
            {audit.length > 0 ? (
              <DataTable
                cols={[430, 330, 560, 300]}
                header={['Action', 'Wallet', 'What', 'When']}
                rows={audit.slice(0, 40).map((a) => ({
                  height: 34,
                  cells: [
                    { text: a.action, size: 13, weight: 'semibold', tone: 'ink' },
                    { text: shortAddress(a.actor), mono: true, size: 12, tone: 'slate' },
                    { text: a.detail ?? 'none', size: 12, tone: 'steel' },
                    { text: timeAgo(a.at), mono: true, size: 12, tone: 'labels' },
                  ],
                }))}
              />
            ) : (
              <Txt size={13} lead={20} tone="slate">
                Nothing has been signed in this station yet.
              </Txt>
            )}
          </Stack>

          {/* the session is bound to the nonce it signed, and can be replaced by
              signing a new one */}
          <Stack
            pad={[14, 16, 14, 16]}
            radius={8}
            bg="indigo"
            hair
            className="mt-6 flex-row items-center justify-between gap-3"
          >
            <Row align="center" gap={10}>
              <Dot tone="sky" size={8} />
              <Txt size={13} lead={18} tone="ink">
                {session?.expiresAt ? sessionNotice(session.expiresAt) : 'A new signature starts a new session, and the old nonce stops working the moment it lands.'}
              </Txt>
            </Row>
            <Btn kind="off" className="shrink-0" disabled={busy} onClick={() => void onSignIn()}>
              Sign a new session
            </Btn>
          </Stack>

          <Stack gap={8} pad={[20, 0, 0, 0]}>
            <Rule />
            <Txt size={12} lead={18} tone="muted">
              The station is the team&apos;s room, not a public page. Nothing here is readable without
              a wallet the owner has already added.
            </Txt>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="mt-2 w-fit text-[12px] leading-[18px] text-souk-peach underline transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
            >
              Sign out
            </button>
          </Stack>
        </>
      )}
    </div>
  )
}

// the owner's panel: paste a wallet, pick a role, sign the change
function ChangeAccess({
  busy,
  members,
  onChange,
}: {
  busy: boolean
  members: StationMember[]
  onChange: (target: string, change: StationRole | 'remove') => void
}) {
  const [address, setAddress] = useState('')
  const [role, setRole] = useState<StationRole>('operator')

  const existing = members.find((m) => m.address.toLowerCase() === address.trim().toLowerCase())

  return (
    <Stack radius={20} hair bg="surface1" pad={[14, 20, 14, 20]} gap={12}>
      <Row align="center" gap={12} className="flex-wrap">
        <label className="sr-only" htmlFor="station-member">
          Wallet address
        </label>
        <input
          id="station-member"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Paste a wallet address"
          spellCheck={false}
          className="h-10 w-full max-w-[360px] rounded-[8px] border border-souk-hair bg-souk-surface2 px-[14px] text-[13px] leading-5 text-souk-ink placeholder:text-souk-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
        />
        <Row align="center" gap={4} pad={[3, 3, 3, 3]} radius={8} bg="surface2" hair>
          {ROLE_ORDER.filter((r) => r !== 'owner').map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={`cursor-pointer rounded-[6px] px-3 py-[7px] text-[13px] leading-[18px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data ${
                role === r ? 'bg-souk-indigo font-semibold text-souk-ink' : 'text-souk-muted hover:text-souk-ink'
              }`}
            >
              {r}
            </button>
          ))}
        </Row>
        <Btn
          kind="primary"
          disabled={busy || address.trim().length === 0}
          onClick={() => onChange(address.trim(), role)}
        >
          {existing ? `Make ${role}` : 'Add member'}
        </Btn>
        {existing ? (
          <Btn
            kind="off"
            disabled={busy}
            onClick={() => onChange(address.trim(), 'remove')}
          >
            Remove
          </Btn>
        ) : null}
        <Pill variant="off">owner only</Pill>
      </Row>
      <Txt size={12} lead={18} tone="muted">
        Every change is signed against a nonce the station issues for it, so the same signature is
        refused the second time it arrives.
      </Txt>
    </Stack>
  )
}
