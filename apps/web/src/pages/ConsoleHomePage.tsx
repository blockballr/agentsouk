import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn } from '../components/souk'
import { askAssistant } from '../components/AssistantChat'
import { getAgentsByOwner, getHiresByPayee, getHiresByWallet, getNotifications, type NotificationRow, type PayeeHire } from '../lib/api'
import { connectWalletWithTimeout, sessionProof } from '../lib/wallet-session'
import { walletErrorText } from '../lib/wallet-errors'
import { useConnectedAccount } from '../lib/use-connected-account'
import { timeAgo } from '../lib/proof-feed'

const STARTERS = ['Which agent can protect my Venus loan?', 'Which stock pools are earning on Flux LP?', 'How do I list my agent?']

const WAYS_IN = [
  { to: '/agents', title: 'Hire an agent', body: 'Pay per answer or on delivery. Nothing moves until you confirm.' },
  { to: '/vault', title: 'Open a vault hire', body: 'Your money stays in a contract; the agent trades only inside your limits.' },
  { to: '/build', title: 'List an agent', body: 'Put your own agent on the shelf and get paid when it works.' },
]

interface Snapshot {
  hires: number
  agents: number
  earned: { asset: string; amount: number }[]
  changes: NotificationRow[]
}

// raw token units to a short number; a chain we cannot read leaves the amount out
function amountOf(h: PayeeHire): number {
  if (h.decimals === null) return 0
  try {
    return Number(BigInt(h.amount) / BigInt(10) ** BigInt(Math.max(0, h.decimals - 6))) / 10 ** Math.min(h.decimals, 6)
  } catch {
    return 0
  }
}

function earnedTotals(rows: PayeeHire[]): { asset: string; amount: number }[] {
  const totals = new Map<string, number>()
  for (const h of rows) {
    if (h.paymentId.startsWith('verify_')) continue
    const asset = `${h.symbol}${h.chainId === 97 ? ' on testnet' : ''}`
    totals.set(asset, (totals.get(asset) ?? 0) + amountOf(h))
  }
  return [...totals].map(([asset, amount]) => ({ asset, amount }))
}

function Card({ to, label, value, note }: { to: string; label: string; value: string; note: string }) {
  return (
    <Link to={to} className="rounded-[14px] border border-souk-hair bg-souk-surface1/60 px-4 py-4 transition-colors hover:border-souk-data/50">
      <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">{label}</span>
      <span className="mt-1 block text-[24px] font-semibold leading-[30px] text-souk-ink">{value}</span>
      <span className="mt-1 block text-[12px] leading-[17px] text-souk-steel">{note}</span>
    </Link>
  )
}

function AskBox() {
  return (
    <section className="rounded-[16px] border border-souk-hair px-5 py-5">
      <h2 className="m-0 text-[15px] font-semibold text-souk-ink">Not sure where to start? Ask.</h2>
      <p className="mt-1 text-[13px] leading-[19px] text-souk-steel">The assistant finds agents, compares them and prepares the next step. You confirm anything that pays.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {STARTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => askAssistant(s)}
            className="rounded-full border border-souk-hair px-3 py-1.5 text-left text-[13px] text-souk-ink transition-colors hover:border-souk-data/50"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  )
}

function WaysIn() {
  return (
    <section>
      <h2 className="m-0 text-[15px] font-semibold text-souk-ink">Three ways to start</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {WAYS_IN.map((w) => (
          <Link key={w.to} to={w.to} className="rounded-[14px] border border-souk-hair px-4 py-4 transition-colors hover:border-souk-data/50">
            <span className="block text-[14px] font-semibold text-souk-ink">{w.title}</span>
            <span className="mt-1 block text-[12.5px] leading-[18px] text-souk-steel">{w.body}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function Connect() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  async function connect() {
    setBusy(true)
    setNote(null)
    try {
      await connectWalletWithTimeout()
    } catch (e) {
      setNote(walletErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-[16px] border border-souk-hair bg-souk-surface1/60 px-5 py-6">
      <h2 className="m-0 text-[18px] font-semibold text-souk-ink">Your hires, your agents and what changed, in one place.</h2>
      <p className="mt-2 max-w-[56ch] text-[14px] leading-[21px] text-souk-slate">
        Connect the wallet you hire or list with. The console only reads; anything that pays or signs asks your wallet first.
      </p>
      <Btn kind="primary" onClick={() => void connect()} disabled={busy} className="mt-4">
        {busy ? 'Connecting...' : 'Connect wallet'}
      </Btn>
      {note ? <p className="mt-2 text-[12px] text-souk-steel">{note}</p> : null}
    </section>
  )
}

export function ConsoleHomePage() {
  const wallet = useConnectedAccount()
  const [snap, setSnap] = useState<Snapshot | null>(null)

  useEffect(() => {
    setSnap(null)
    if (!wallet) return
    let alive = true
    void (async () => {
      const proof = await sessionProof(wallet).catch(() => null)
      const [hires, owned, paid, notes] = await Promise.all([
        getHiresByWallet(wallet).catch(() => []),
        getAgentsByOwner(wallet).catch(() => null),
        getHiresByPayee(wallet).catch(() => null),
        proof ? getNotifications(wallet, proof).catch(() => ({ rows: [], unread: 0 })) : Promise.resolve({ rows: [], unread: 0 }),
      ])
      if (!alive) return
      setSnap({
        hires: hires.length,
        agents: owned?.agents.length ?? 0,
        earned: earnedTotals(paid?.hires ?? []),
        changes: notes.rows.slice(0, 6),
      })
    })()
    return () => {
      alive = false
    }
  }, [wallet])

  const fresh = snap && snap.hires === 0 && snap.agents === 0 && snap.changes.length === 0

  return (
    <div className="grid max-w-[920px] gap-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-souk-data">Console</p>
        <h1 className="mt-1 text-[30px] font-bold leading-[36px] text-souk-ink">Home</h1>
      </header>

      {!wallet ? (
        <>
          <Connect />
          <WaysIn />
          <AskBox />
        </>
      ) : !snap ? (
        <p className="text-[13px] text-souk-steel">Reading your wallet...</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card to="/ongoing" label="My hires" value={String(snap.hires)} note={snap.hires ? 'Open the list' : 'Nothing hired yet'} />
            <Card to="/seller" label="My agents" value={String(snap.agents)} note={snap.agents ? 'Checks and earnings' : 'Nothing listed yet'} />
            <Card
              to="/seller"
              label="Earned"
              value={snap.earned.length ? snap.earned.map((e) => `${Number(e.amount.toFixed(4))} ${e.asset}`).join(', ') : '0'}
              note="Paid to this wallet by buyers"
            />
          </div>

          {snap.changes.length ? (
            <section>
              <h2 className="m-0 text-[15px] font-semibold text-souk-ink">What changed</h2>
              <ul className="mt-3 divide-y divide-souk-hair rounded-[14px] border border-souk-hair">
                {snap.changes.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold text-souk-ink">{n.title}</span>
                      <span className="block text-[12.5px] leading-[18px] text-souk-steel">{n.body}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-mono text-[11px] text-souk-labels">{timeAgo(n.createdAt)}</span>
                      {n.href ? (
                        <Link to={n.href} className="text-[12px] text-souk-sky hover:underline">
                          Open
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {fresh ? (
            <>
              <WaysIn />
              <AskBox />
            </>
          ) : null}
        </>
      )}

      <p className="text-[12px] leading-[18px] text-souk-labels">
        Set and Earn closed on 5 November.{' '}
        <Link to="/quest" className="text-souk-sky hover:underline">
          See where you finished
        </Link>
        .
      </p>
    </div>
  )
}
