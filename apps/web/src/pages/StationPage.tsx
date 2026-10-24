import { useCallback, useEffect, useState } from 'react'
import { shortAddress, timeAgo, timeUntil } from '@agora/core'
import {
  changeMemberRole,
  stationMembers,
  stationOperations,
  stationShelfHealth,
  stationSweep,
  stationProbe,
  stationSignIn,
  stationSignOut,
  type AuditEntry,
  type StationMember,
  type StationOperations,
  type StationRole,
  type StationShelfHealth,
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
  const [shelf, setShelf] = useState<StationShelfHealth | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sweepBusy, setSweepBusy] = useState(false)
  const [sweepResult, setSweepResult] = useState<string | null>(null)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeResult, setProbeResult] = useState<string | null>(null)

  const load = useCallback(async (token: string) => {
    const [list, operations, shelfHealth] = await Promise.all([
      stationMembers(token),
      stationOperations(token).catch(() => null),
      stationShelfHealth(token).catch(() => null),
    ])
    setMembers(list.members)
    setAudit(list.audit)
    if (operations) setOps(operations.operations)
    if (shelfHealth) setShelf(shelfHealth.health)
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

  async function onSweep() {
    if (!session?.token) return
    setSweepBusy(true)
    setSweepResult(null)
    try {
      await stationSweep(session.token)
      setSweepResult('Sweep complete: the shelf was re-read and re-classified.')
      await load(session.token)
    } catch (e) {
      setSweepResult((e as Error).message)
    } finally {
      setSweepBusy(false)
    }
  }

  const [probeDry, setProbeDry] = useState(true)
  const [probeAll, setProbeAll] = useState(false)
  async function onProbe() {
    if (!session?.token) return
    setProbeBusy(true)
    setProbeResult(null)
    try {
      const out = await stationProbe(session.token, 25, probeAll, probeDry)
      const probed = (out as { probed?: number }).probed ?? 0
      const posted = (out as { oracle?: { posted?: number } }).oracle?.posted ?? 0
      setProbeResult(
        probeDry
          ? `Dry probe complete: ${probed} listings checked, no gas spent.`
          : `Probe complete: ${probed} listings checked, ${posted} heartbeats posted.`,
      )
      await load(session.token)
    } catch (e) {
      setProbeResult((e as Error).message)
    } finally {
      setProbeBusy(false)
    }
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
      <Stack gap={10} pad={[32, 0, 0, 0]} className="w-full">
        <Txt size={11} lead={16} mono upper tone="data">
          {`Station · station.agentsouk.xyz · ${members.length} member${members.length === 1 ? '' : 's'}`}
        </Txt>
        <Txt size={34} lead={42} weight="bold" tone="ink">
          Control Room.
        </Txt>
      </Stack>

      {error ? (
        <div className="mt-6 rounded-[10px] border border-souk-peach/45 p-4" role="note">
          <Txt size={13} lead={20} tone="peach">
            {error}
          </Txt>
        </div>
      ) : null}

      {signedIn && (
        <>
          <Stack surface pad={[20, 22, 20, 22]} gap={12} className="mt-6">
            <SectionHead title="Sweep the shelf" note="RE-READ AND RE-CLASSIFY" />
            <Txt size={13} lead={20} tone="slate">
              Re-reads the registry, re-classifies every agent, and captures the skills a listing
              declares, so job-capable agents carry both badges and sort into the jobs tier. The
              result shows on the shelf within a minute.
            </Txt>
            <Row gap={8} align="center" className="flex-wrap">
              <Btn
                kind="primary"
                disabled={busy || sweepBusy || session?.role === 'viewer'}
                onClick={() => void onSweep()}
              >
                {sweepBusy ? 'Sweeping...' : 'Sweep now'}
              </Btn>
              {session?.role === 'viewer' ? (
                <Txt size={12} lead={18} tone="muted">
                  Viewers watch; operators and owners run the sweep.
                </Txt>
              ) : null}
            </Row>
            {sweepResult && (
              <Txt size={12} lead={18} tone="data">
                {sweepResult}
              </Txt>
            )}
          </Stack>

          <Stack surface pad={[20, 22, 20, 22]} gap={12} className="mt-6">
            <SectionHead title="Probe liveness" note="CHECK ENDPOINTS AND RECORD READINGS" />
            <Txt size={13} lead={20} tone="slate">
              Probes up to 25 listings whose reading is due, records the delivered / dead / unreachable
              verdict, and (unless dry) posts a heartbeat to the liveness oracle. Use dry run to refresh
              the reachability sort without spending gas.
            </Txt>
            <Row gap={8} align="center" className="flex-wrap">
              <Btn
                kind="primary"
                disabled={busy || probeBusy || session?.role === 'viewer'}
                onClick={() => void onProbe()}
              >
                {probeBusy ? 'Probing...' : probeDry ? 'Probe (dry)' : 'Probe (live)'}
              </Btn>
              <label className="flex items-center gap-2 text-[12px] text-souk-steel">
                <input
                  type="checkbox"
                  checked={probeDry}
                  onChange={(e) => setProbeDry(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Dry run (no gas)
              </label>
              <label className="flex items-center gap-2 text-[12px] text-souk-steel">
                <input
                  type="checkbox"
                  checked={probeAll}
                  onChange={(e) => setProbeAll(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Check all (ignore freshness)
              </label>
              {session?.role === 'viewer' ? (
                <Txt size={12} lead={18} tone="muted">
                  Viewers watch; operators and owners run the probe.
                </Txt>
              ) : null}
            </Row>
            {probeResult && (
              <Txt size={12} lead={18} tone="data">
                {probeResult}
              </Txt>
            )}
          </Stack>
        </>
      )}

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

          {/* the shelf's health: holding, failing, gone */}
          {shelf ? (
            <Stack gap={12} pad={[20, 0, 0, 0]}>
              <SectionHead title="Shelf health" note={`WHAT THE SHELF HOLDS, ON A ${shelf.windowDays} DAY CLOCK`} />
              <Row align="center" gap={8} className="flex-wrap">
                <Pill variant="off">{`${shelf.onShelf.total} on the shelf`}</Pill>
                <Pill variant="keep">{`${shelf.onShelf.answering} answering`}</Pill>
                {shelf.failing.length ? (
                  <Pill variant="warn">{`${shelf.failing.length} failing`}</Pill>
                ) : null}
                <Pill variant="off">{`${shelf.delisted.length} delisted, relistable`}</Pill>
                <Pill variant="off">{`${shelf.neverEligible} never eligible`}</Pill>
              </Row>
              {shelf.failing.length ? (
                <DataTable
                  cols={[420, 220, 160, 200]}
                  header={['Failing', 'Category', 'Reads as', 'Clock']}
                  rows={shelf.failing.map((f) => ({
                    height: 34,
                    cells: [
                      { text: f.name, size: 13, tone: 'ink' },
                      { text: f.category, size: 12, tone: 'slate' },
                      { text: f.status, size: 12, mono: true, tone: 'peach' },
                      {
                        text: f.daysLeft <= 0 ? 'due for removal' : `${f.daysLeft}d left`,
                        size: 12,
                        mono: true,
                        tone: f.daysLeft <= 1 ? 'peach' : 'steel',
                      },
                    ],
                  }))}
                />
              ) : null}
              {shelf.delisted.length ? (
                <DataTable
                  cols={[420, 220, 200]}
                  header={['Delisted', 'Why', 'Off since']}
                  rows={shelf.delisted.map((d) => ({
                    height: 34,
                    cells: [
                      { text: d.name, size: 13, tone: 'ink' },
                      { text: d.delisted?.reason ?? 'manual', size: 12, tone: 'steel' },
                      {
                        text: d.delisted?.at ? timeAgo(d.delisted.at) : 'unknown',
                        size: 12,
                        mono: true,
                        tone: 'muted',
                      },
                    ],
                  }))}
                />
              ) : null}
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
              <Txt size={13} lead={18} tone="white">
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
                role === r ? 'bg-souk-indigo font-semibold text-souk-white' : 'text-souk-muted hover:text-souk-ink'
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
