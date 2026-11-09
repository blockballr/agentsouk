import { useEffect, useState } from 'react'
import { decodeFunctionResult, encodeFunctionData, formatUnits, parseUnits, type Hex } from 'viem'
import { deriveDefence } from '@souk/machines/defence'
import { getProvider, ensureBscChain } from '../lib/wallet'
import { useConnectedAccount } from '../lib/use-connected-account'
import { Section, Stack, Row, Txt, Btn, Label, Rule } from '../components/souk'

// The buyer's side of the guard. The position stays on Venus in the buyer's own
// wallet; this screen only writes the authority (a mandate) and the prepaid fee
// balance, both of which the buyer can revoke without asking anyone.

const OPERATOR = '0xb63cd6dbe6a48761190f4d3a819b0485c43221d6' as const
const SUBSCRIPTION = '0x14ca53f7b4edfc9b0f49d6fe25532339c7ec5877' as const
const AGENT = '0x84FEDaBd1B83443Ad86796C15619494878B64180' as const
const USDT = '0x55d398326f99059fF775485246999027B3197955' as const
const VUSDT = '0xfD5840Cd36d94D7229439859C0112a4185BC0255' as const

const ERC20 = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const MANDATE = [
  {
    name: 'mandateOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'buyer', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'agent', type: 'address' },
          { name: 'asset', type: 'address' },
          { name: 'triggerBps', type: 'uint32' },
          { name: 'targetBps', type: 'uint32' },
          { name: 'maxRepayPerCall', type: 'uint128' },
          { name: 'maxRepayPerDay', type: 'uint128' },
          { name: 'expiry', type: 'uint64' },
          { name: 'active', type: 'bool' },
          { name: 'positions', type: 'tuple[]', components: [{ name: 'account', type: 'address' }, { name: 'vTokenDebt', type: 'address' }] },
        ],
      },
    ],
  },
  {
    name: 'setMandate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'triggerBps', type: 'uint32' },
      { name: 'targetBps', type: 'uint32' },
      { name: 'maxRepayPerCall', type: 'uint128' },
      { name: 'maxRepayPerDay', type: 'uint128' },
      { name: 'expiry', type: 'uint64' },
      { name: 'positions', type: 'tuple[]', components: [{ name: 'account', type: 'address' }, { name: 'vTokenDebt', type: 'address' }] },
    ],
    outputs: [],
  },
  { name: 'revoke', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const

const SUB = [
  {
    name: 'planOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'buyer', type: 'address' }],
    outputs: [
      { type: 'tuple', components: [{ name: 'agent', type: 'address' }, { name: 'dailyRate', type: 'uint128' }, { name: 'expiry', type: 'uint64' }, { name: 'lastCharge', type: 'uint64' }] },
    ],
  },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'buyer', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'accrued', type: 'function', stateMutability: 'view', inputs: [{ name: 'buyer', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'setPlan', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'agent', type: 'address' }, { name: 'dailyRate', type: 'uint128' }, { name: 'expiry', type: 'uint64' }], outputs: [] },
  { name: 'cancel', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const

interface MandateView {
  agent: string
  triggerBps: number
  targetBps: number
  maxRepayPerCall: bigint
  maxRepayPerDay: bigint
  expiry: bigint
  active: boolean
  positions: readonly { account: string; vTokenDebt: string }[]
}

interface PlanView {
  agent: string
  dailyRate: bigint
  expiry: bigint
  lastCharge: bigint
}

interface WatchStatus {
  lastRunAt: string | null
  ageMs: number | null
  stale: boolean
  ok: boolean
  consecutiveFailures: number
  degraded: boolean
  note: string | null
  gas?: { wei: string | null; low: boolean; checkedAt: string } | null
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

function ago(ms: number | null): string {
  if (ms === null) return 'never'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function call(provider: Awaited<ReturnType<typeof getProvider>>, to: string, data: Hex): Promise<Hex> {
  return (await provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] })) as Hex
}

export function DefendPage() {
  const account = useConnectedAccount()
  const [mandate, setMandate] = useState<MandateView | null>(null)
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [fee, setFee] = useState<bigint | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [allowance, setAllowance] = useState<bigint | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [watch, setWatch] = useState<WatchStatus | null>(null)

  const [trigger, setTrigger] = useState('1.20')
  const [target, setTarget] = useState('1.50')
  const [perCall, setPerCall] = useState('1')
  const [perDay, setPerDay] = useState('1')
  const [days, setDays] = useState('7')
  const [dailyRate, setDailyRate] = useState('0.01')
  const [deposit, setDeposit] = useState('0.05')

  // one derivation for the page, the API and the CLI; the detailed cards below
  // still show each contract, but this is the state a buyer reads first
  const defence = account
    ? deriveDefence({
        now: Math.floor(Date.now() / 1000),
        mandate: mandate
          ? { active: true, expiry: Number(mandate.expiry), positions: mandate.positions.length }
          : null,
        plan: plan ? { agent: plan.agent, expiry: Number(plan.expiry) } : null,
        feeBalance: fee ?? 0n,
        watch: watch ? { stale: watch.stale, consecutiveFailures: watch.consecutiveFailures, ok: watch.ok } : null,
        gasLow: watch?.gas ? watch.gas.low : null,
      })
    : null

  const say = (line: string) => setLog((lines) => [...lines.slice(-8), line])

  async function refresh() {
    if (!account) return
    const provider = await getProvider()
    try {
      const raw = await call(provider, OPERATOR, encodeFunctionData({ abi: MANDATE, functionName: 'mandateOf', args: [account as `0x${string}`] }))
      const view = decodeFunctionResult({ abi: MANDATE, functionName: 'mandateOf', data: raw }) as MandateView
      setMandate(view.active ? view : null)

      const planRaw = await call(provider, SUBSCRIPTION, encodeFunctionData({ abi: SUB, functionName: 'planOf', args: [account as `0x${string}`] }))
      const planView = decodeFunctionResult({ abi: SUB, functionName: 'planOf', data: planRaw }) as PlanView
      setPlan(planView.agent === '0x0000000000000000000000000000000000000000' ? null : planView)

      const feeRaw = await call(provider, SUBSCRIPTION, encodeFunctionData({ abi: SUB, functionName: 'balanceOf', args: [account as `0x${string}`] }))
      setFee(decodeFunctionResult({ abi: SUB, functionName: 'balanceOf', data: feeRaw }) as bigint)

      const balRaw = await call(provider, USDT, encodeFunctionData({ abi: ERC20, functionName: 'balanceOf', args: [account as `0x${string}`] }))
      setBalance(decodeFunctionResult({ abi: ERC20, functionName: 'balanceOf', data: balRaw }) as bigint)

      const allowRaw = await call(provider, USDT, encodeFunctionData({ abi: ERC20, functionName: 'allowance', args: [account as `0x${string}`, OPERATOR] }))
      setAllowance(decodeFunctionResult({ abi: ERC20, functionName: 'allowance', data: allowRaw }) as bigint)
    } catch {
      setError('The chain did not answer. Check the wallet network.')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  useEffect(() => {
    let live = true
    const read = () =>
      fetch(`${API_BASE}/health/status`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (live && body && typeof body.stale === 'boolean') setWatch(body as WatchStatus)
        })
        .catch(() => {})
    void read()
    const timer = setInterval(read, 60_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  async function send(to: string, data: Hex, label: string): Promise<string> {
    if (!account) throw new Error('connect a wallet first')
    const provider = await getProvider()
    const hash = (await provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to, data }] })) as Hex
    for (let i = 0; i < 90; i++) {
      await sleep(2_000)
      const receipt = (await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as { status?: string } | null
      if (!receipt) continue
      if (receipt.status === '0x1' || receipt.status === 'success') return hash
      throw new Error(`${label} reverted (${hash})`)
    }
    throw new Error(`${label} did not confirm in time (${hash})`)
  }

  async function saveMandate() {
    setError(null)
    setBusy('mandate')
    try {
      if (!account) throw new Error('connect a wallet first')
      await ensureBscChain()
      const triggerBps = Math.round(Number(trigger) * 10_000)
      const targetBps = Math.round(Number(target) * 10_000)
      if (!(triggerBps > 0) || !(targetBps > triggerBps)) throw new Error('the target must sit above the trigger')
      const term = Number(days)
      if (!Number.isFinite(term) || term < 1 || term > 90) throw new Error('the term runs from one to ninety days')
      const cap = parseUnits(perDay, 18)
      const callCap = parseUnits(perCall, 18)
      if (cap < callCap) throw new Error('the daily cap cannot sit below the per call cap')
      // the most the operator can ever pull under this mandate
      const total = cap * BigInt(term)
      const expiry = BigInt(Math.floor(Date.now() / 1000) + term * 86_400)

      say(`Approve ${formatUnits(total, 18)} USDT for the operator.`)
      const approveData = encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [OPERATOR, total] })
      say(`approved ${await send(USDT, approveData, 'approve')}`)

      const data = encodeFunctionData({
        abi: MANDATE,
        functionName: 'setMandate',
        args: [AGENT, USDT, triggerBps, targetBps, callCap, cap, expiry, [{ account: account as `0x${string}`, vTokenDebt: VUSDT }]],
      })
      say(`set the mandate ${await send(OPERATOR, data, 'setMandate')}`)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function subscribe() {
    setError(null)
    setBusy('subscribe')
    try {
      if (!account) throw new Error('connect a wallet first')
      await ensureBscChain()
      const amount = parseUnits(deposit, 18)
      const rate = parseUnits(dailyRate, 18)
      const term = Number(days)
      if (!Number.isFinite(term) || term < 1 || term > 365) throw new Error('the plan runs from one to 365 days')
      if (!(amount > 0n)) throw new Error('deposit something so the watch can be paid')
      if (!(rate > 0n)) throw new Error('the daily rate must be above zero')
      const expiry = BigInt(Math.floor(Date.now() / 1000) + term * 86_400)
      say(`Approve ${deposit} USDT for the fee balance.`)
      say(`approved ${await send(USDT, encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [SUBSCRIPTION, amount] }), 'approve')}`)
      say(`deposited ${await send(SUBSCRIPTION, encodeFunctionData({ abi: SUB, functionName: 'deposit', args: [amount] }), 'deposit')}`)
      say(`plan set ${await send(SUBSCRIPTION, encodeFunctionData({ abi: SUB, functionName: 'setPlan', args: [AGENT, rate, expiry] }), 'setPlan')}`)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function revoke() {
    setError(null)
    setBusy('revoke')
    try {
      await ensureBscChain()
      say(`revoked ${await send(OPERATOR, encodeFunctionData({ abi: MANDATE, functionName: 'revoke' }), 'revoke')}`)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    setError(null)
    setBusy('cancel')
    try {
      await ensureBscChain()
      say(`cancelled ${await send(SUBSCRIPTION, encodeFunctionData({ abi: SUB, functionName: 'cancel' }), 'cancel')}`)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function withdraw() {
    setError(null)
    setBusy('withdraw')
    try {
      if (!fee || fee === 0n) throw new Error('nothing is left to withdraw')
      await ensureBscChain()
      say(`withdrawn ${await send(SUBSCRIPTION, encodeFunctionData({ abi: SUB, functionName: 'withdraw', args: [fee] }), 'withdraw')}`)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section pad="pt-10 pb-16">
      <Stack gap={28}>
        <Stack gap={10}>
          <Txt size={10} lead={14} mono upper tone="muted">
            Health guard
          </Txt>
          <h1 className="font-serif text-[34px] font-bold leading-[42px] text-souk-ink">Defend a position</h1>
          <Txt size={14} lead={22} tone="slate" className="max-w-2xl">
            The position stays on Venus in your own wallet. This screen writes the authority the agent acts under and
            the fee balance it draws from. Both are revocable here at any time.
          </Txt>
          {account && defence ? (
            <Stack gap={3}>
              <Row gap={8} className="items-baseline">
                <Txt size={10} lead={14} mono upper tone="muted">
                  Defence
                </Txt>
                <Txt
                  size={13}
                  lead={20}
                  weight="semibold"
                  tone={defence.phase === 'protected' ? 'ink' : 'peach'}
                >
                  {defence.phase}
                </Txt>
              </Row>
              <Txt size={12} lead={18} tone="slate">
                {defence.reason}
              </Txt>
              {watch ? (
                <Txt size={10} lead={14} mono tone="steel">
                  Watcher {defence.watch} · last check {ago(watch.ageMs)}
                  {defence.nextEvent.at
                    ? ` · next ${defence.nextEvent.kind.replace('-', ' ')} ${new Date(defence.nextEvent.at * 1000).toISOString().slice(0, 10)}`
                    : ''}
                </Txt>
              ) : null}
            </Stack>
          ) : watch ? (
            <Txt size={12} lead={18} mono tone={watch.stale || watch.consecutiveFailures >= 2 ? 'peach' : 'steel'}>
              {watch.stale
                ? `The watcher last reported ${ago(watch.ageMs)}. Nothing is checking positions right now.`
                : watch.consecutiveFailures >= 2
                  ? `The watcher has failed ${watch.consecutiveFailures} runs in a row.`
                  : `Watcher healthy · last check ${ago(watch.ageMs)}`}
            </Txt>
          ) : null}
        </Stack>

        {!account ? (
          <Txt size={13} lead={20} tone="slate">
            Connect a wallet to read or write a mandate.
          </Txt>
        ) : (
          <>
            <Stack gap={8} surface pad={[16, 16, 14, 16]}>
              <Label tone="muted">Your mandate</Label>
              {mandate ? (
                <Stack gap={6}>
                  <Txt size={13} lead={20} tone="ink">
                    Active: act below {(mandate.triggerBps / 10_000).toFixed(2)}, repay to{' '}
                    {(mandate.targetBps / 10_000).toFixed(2)}, up to {formatUnits(mandate.maxRepayPerCall, 18)} USDT per
                    call and {formatUnits(mandate.maxRepayPerDay, 18)} USDT per day, until{' '}
                    {new Date(Number(mandate.expiry) * 1000).toISOString().slice(0, 10)}.
                  </Txt>
                  <Txt size={11} lead={16} mono tone="steel">
                    {mandate.positions.length} position{mandate.positions.length === 1 ? '' : 's'} · allowance{' '}
                    {allowance === null ? '-' : formatUnits(allowance, 18)} USDT
                  </Txt>
                  <Row gap={8}>
                    <Btn kind="off" onClick={revoke} disabled={busy !== null}>
                      {busy === 'revoke' ? 'Revoking' : 'Revoke the mandate'}
                    </Btn>
                  </Row>
                </Stack>
              ) : (
                <Txt size={13} lead={20} tone="slate">
                  No mandate yet. The agent cannot touch anything until you write one.
                </Txt>
              )}
            </Stack>

            <Rule />

            <Stack gap={14} surface pad={[16, 16, 16, 16]}>
              <Label tone="muted">Write the mandate</Label>
              <Txt size={12} lead={18} tone="steel">
                Supply and borrow on Venus first. The guard only repays debt; it never borrows, redeems or moves your
                position.
              </Txt>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { label: 'Act below', value: trigger, set: setTrigger, hint: 'coverage' },
                  { label: 'Repay to', value: target, set: setTarget, hint: 'coverage' },
                  { label: 'Days', value: days, set: setDays, hint: 'expiry' },
                  { label: 'Per call', value: perCall, set: setPerCall, hint: 'USDT' },
                  { label: 'Per day', value: perDay, set: setPerDay, hint: 'USDT' },
                ].map((field) => (
                  <Stack key={field.label} gap={6}>
                    <Label tone="muted">{field.label}</Label>
                    <input
                      value={field.value}
                      onChange={(e) => field.set(e.target.value)}
                      inputMode="decimal"
                      className="h-10 w-full border border-souk-hair bg-souk-surface2 px-3 font-mono text-[12px] text-souk-ink outline-none focus:border-souk-data"
                    />
                    <Txt size={10} lead={14} mono tone="steel">
                      {field.hint}
                    </Txt>
                  </Stack>
                ))}
              </div>
              <Row gap={8} className="flex-wrap">
                <Btn kind="primary" onClick={saveMandate} disabled={busy !== null}>
                  {busy === 'mandate' ? 'Writing' : 'Approve and set the mandate'}
                </Btn>
                <Txt size={11} lead={16} mono tone="steel">
                  wallet balance {balance === null ? '-' : formatUnits(balance, 18)} USDT
                </Txt>
              </Row>
            </Stack>

            <Stack gap={14} surface pad={[16, 16, 16, 16]}>
              <Label tone="muted">Prepay the watch</Label>
              {plan ? (
                <Txt size={13} lead={20} tone="ink">
                  Plan: {formatUnits(plan.dailyRate, 18)} USDT per day, expires{' '}
                  {new Date(Number(plan.expiry) * 1000).toISOString().slice(0, 10)}. Balance{' '}
                  {fee === null ? '-' : formatUnits(fee, 18)} USDT.
                </Txt>
              ) : (
                <Txt size={13} lead={20} tone="slate">
                  No plan. The agent watches no position without a balance.
                </Txt>
              )}
              <Txt size={11} lead={16} mono tone="steel">
                The plan runs for the same {days} day{days === '1' ? '' : 's'} as the mandate. Unspent balance stays
                yours.
              </Txt>
              <div className="grid gap-4 sm:grid-cols-2">
                <Stack gap={6}>
                  <Label tone="muted">Daily rate</Label>
                  <input value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} inputMode="decimal" className="h-10 w-full border border-souk-hair bg-souk-surface2 px-3 font-mono text-[12px] text-souk-ink outline-none focus:border-souk-data" />
                  <Txt size={10} lead={14} mono tone="steel">USDT per day</Txt>
                </Stack>
                <Stack gap={6}>
                  <Label tone="muted">Deposit</Label>
                  <input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" className="h-10 w-full border border-souk-hair bg-souk-surface2 px-3 font-mono text-[12px] text-souk-ink outline-none focus:border-souk-data" />
                  <Txt size={10} lead={14} mono tone="steel">USDT, refundable</Txt>
                </Stack>
              </div>
              <Row gap={8} className="flex-wrap">
                <Btn kind="keep" onClick={subscribe} disabled={busy !== null}>
                  {busy === 'subscribe' ? 'Funding' : 'Approve, deposit and set the plan'}
                </Btn>
                {plan ? (
                  <Btn kind="off" onClick={cancel} disabled={busy !== null}>
                    {busy === 'cancel' ? 'Cancelling' : 'Cancel the plan'}
                  </Btn>
                ) : null}
                {fee !== null && fee > 0n ? (
                  <Btn kind="off" onClick={withdraw} disabled={busy !== null}>
                    {busy === 'withdraw' ? 'Withdrawing' : `Withdraw ${formatUnits(fee, 18)} USDT`}
                  </Btn>
                ) : null}
              </Row>
            </Stack>

            {error ? (
              <Txt size={12} lead={18} mono tone="peach">
                {error}
              </Txt>
            ) : null}

            {log.length > 0 ? (
              <Stack gap={4}>
                {log.map((line, index) => (
                  <Txt key={`${line}-${index}`} size={10} lead={14} mono tone="steel">
                    {line}
                  </Txt>
                ))}
              </Stack>
            ) : null}
          </>
        )}
      </Stack>
    </Section>
  )
}
