import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SESSION_HOURS, SESSION_SPEND_CAP_USD, sellsByJob, shortAddress } from '@agora/core'
import { getCart, removeFromCart, subscribe, type CartItem } from '../lib/cart'
import { getAgentDetail } from '../lib/api'
import { ensureBscChain } from '../lib/wallet'
import { connectWallet } from '../lib/wallet-session'
import { hireErrorText, runHire } from '../lib/hire'
import { chainLabel, explorerTxBase, settlementAssetFor } from '../lib/contracts'
import {
  AgentAvatar,
  Btn,
  Dot,
  type DotTone,
  SoukMark,
  Row,
  Rule,
  Section,
  SectionHead,
  Stack,
  Txt,
} from '../components/souk'

const PRICE_USD = 2

type StepStatus = 'queued' | 'requirements' | 'signing' | 'settling' | 'done' | 'failed'

interface Step {
  status: StepStatus
  error?: string
}

type SettlementMode = 'sandbox' | 'prod' | 'b402'

interface Receipt {
  name: string
  paymentId?: string
  txHash?: string
  chainId: number
  mode?: SettlementMode
  receiptLoaded?: boolean
}

const statusLabel: Record<Exclude<StepStatus, 'failed'>, string> = {
  queued: 'Queued',
  requirements: 'Preparing',
  signing: 'Signing',
  settling: 'Settling',
  done: 'Settled',
}

// a hash is only a transaction when something was broadcast; a sandbox string is synthetic
function isOnchainSettlement(mode: Receipt['mode']): boolean {
  return mode === 'prod' || mode === 'b402'
}

// filled is settled, lit is the one in flight, ringed is queued or failed
function dotToneFor(status: StepStatus): DotTone {
  if (status === 'done') return 'good'
  if (status === 'failed') return 'bad'
  if (status === 'queued') return 'quiet'
  return 'sky'
}

const MODE_TONE: Record<SettlementMode, 'data' | 'peach'> = {
  prod: 'data',
  b402: 'data',
  sandbox: 'peach',
}

// the design's five columns across the surface's full run, as shares of it
const SUMMARY_COLS = ['22.6%', '18.3%', '16.7%', '12.9%', '29.4%']
const SUMMARY_HEADER = ['Agent', 'Payment id', 'Settlement', 'Mode', 'Receipt']

export function CartPage() {
  const [items, setItems] = useState<CartItem[]>(() => getCart())
  const [steps, setSteps] = useState<Record<string, Step>>({})
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({})
  const [running, setRunning] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // job sellers can no longer be added, but a cart saved before the guard may
  // still hold one; each is read once and kept out of checkout instead of
  // failing at requirements with nothing signed
  const [jobOnlyKeys, setJobOnlyKeys] = useState<string[]>([])
  const addressRef = useRef<string | null>(null)

  useEffect(() => subscribe(() => setItems(getCart())), [])

  useEffect(() => {
    let stale = false
    void (async () => {
      const found: string[] = []
      for (const item of items) {
        try {
          const d = await getAgentDetail(String(item.chainId), String(item.tokenId))
          if (d && sellsByJob(d.skills)) found.push(`${item.chainId}/${item.tokenId}`)
        } catch {
          // an unreadable detail stays in checkout; the server refuses it safely
        }
      }
      if (!stale) setJobOnlyKeys(found)
    })()
    return () => {
      stale = true
    }
  }, [items])

  function setStep(key: string, step: Step) {
    setSteps((prev) => ({ ...prev, [key]: step }))
  }

  function handleRemove(item: CartItem) {
    removeFromCart(item.chainId, item.tokenId)
  }

  async function runCheckout(targets: CartItem[]) {
    if (running || connecting || targets.length === 0) return
    setNotice(null)

    let addr = addressRef.current
    if (!addr) {
      setConnecting(true)
      try {
        addr = await connectWallet()
        await ensureBscChain()
        addressRef.current = addr
        setAddress(addr)
      } catch (e) {
        setNotice(hireErrorText(e))
        setConnecting(false)
        return
      }
      setConnecting(false)
    }

    setRunning(true)
    const settled: string[] = []
    for (const item of targets) {
      const key = `${item.chainId}/${item.tokenId}`
      setStep(key, { status: 'requirements' })
      const outcome = await runHire(item, { address: addr }, (s) => {
        setStep(key, { status: s.phase, error: s.error })
      })
      if (outcome.success) {
        settled.push(key)
        setReceipts((prev) => ({
          ...prev,
          [key]: {
            name: item.name,
            paymentId: outcome.paymentId,
            txHash: outcome.txHash,
            chainId: item.chainId,
            // the receipt mode is authoritative; settle details cover a receipt that did not load
            mode: outcome.receipt?.mode ?? outcome.settle?.details?.mode,
            receiptLoaded: Boolean(outcome.receipt),
          },
        }))
      }
      // a rejected signature means the user said stop: leave the rest queued
      if (outcome.cancelled) {
        setNotice('Checkout stopped. The rest of the queue is untouched.')
        break
      }
    }
    setRunning(false)
    // settled items leave the cart, failed ones stay for retry
    for (const key of settled) {
      const [chainId, tokenId] = key.split('/').map(Number)
      removeFromCart(chainId, tokenId)
    }
  }

  function handleCheckout() {
    void runCheckout(directItems)
  }

  function handleRetry(key: string) {
    const item = directItems.find((i) => `${i.chainId}/${i.tokenId}` === key)
    if (item) void runCheckout([item])
  }

  const isJobOnly = (key: string) => jobOnlyKeys.includes(key)
  const directItems = items.filter((i) => !isJobOnly(`${i.chainId}/${i.tokenId}`))
  const jobItemCount = items.length - directItems.length
  const failedKeys = directItems
    .map((i) => `${i.chainId}/${i.tokenId}`)
    .filter((key) => steps[key]?.status === 'failed')
  const summary = Object.entries(receipts)
  const busy = running || connecting

  const chainIds = [...new Set(items.map((i) => i.chainId))]
  const strap = [
    'cart',
    address ? `wallet ${shortAddress(address)}` : null,
    chainIds.map((id) => `${chainLabel(id)} ${id}`).join(' + '),
    `${directItems.length} hire${directItems.length === 1 ? '' : 's'}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
  const total = directItems.length * PRICE_USD
  const asset = chainIds.length === 1 ? settlementAssetFor(chainIds[0]) : null

  // the terms a buyer reads before they sign. The session cap is last on purpose,
  // it is the number a buyer checks before they sign
  const authRows = [
    {
      key: 'Price',
      value: `${PRICE_USD} U per hire · ${total} U total`,
      note: 'x402 · EIP-3009',
      highlighted: false,
    },
    {
      key: 'Network',
      value: chainIds.map((id) => `${chainLabel(id)} ${id}`).join(' + '),
      note: asset ? `settles in ${asset.symbol}` : 'settles in the settlement asset',
      highlighted: false,
    },
    {
      key: 'Method',
      value: 'one gas-free transfer per agent',
      note: 'no standing token approval',
      highlighted: false,
    },
    {
      key: 'Settlement',
      value: 'confirmed at settlement',
      note: 'the mode is in the receipt',
      highlighted: false,
    },
    {
      key: 'Session',
      value: `${SESSION_HOURS}h · $${SESSION_SPEND_CAP_USD} spend cap`,
      note: 'the ceiling on this session',
      highlighted: true,
    },
  ]

  return (
    <div className="min-h-screen bg-souk-canvas text-souk-ink">
      <div className="px-4 lg:px-8 pb-20">
      {/* the hero owns its own top padding, so the band carries only the lower half of the rhythm */}
      <Section pad="pb-16 md:pb-18">
        <Stack gap={10} pad={[32, 0, 0, 0]}>
          <Txt size={11} lead={16} mono upper tone="data">
            {strap}
          </Txt>
          <Txt size={34} lead={42} display weight="bold" tone="ink">
            One checkout, one signature each.
          </Txt>
        </Stack>

        {notice ? (
          <Stack className="mt-6" radius={14} hair pad={[14, 16, 14, 16]}>
            <Txt size={12} lead={18} tone="slate">
              {notice}
            </Txt>
          </Stack>
        ) : null}
      </Section>

        {items.length > 0 ? (
          <Section>
            <Row align="start" gap={20} className="flex-wrap">
            <Stack
              surface
              pad={[20, 22, 20, 22]}
              gap={14}
              className="min-w-0 flex-1"
            >
              {items.map((item) => {
                const key = `${item.chainId}/${item.tokenId}`
                const job = isJobOnly(key)
                const step = steps[key]?.status ?? 'queued'
                return (
                  <Row key={key} align="center" gap={14} className="flex-wrap">
                    <Row align="center" gap={12} grow className="min-w-0">
                      <AgentAvatar size={40} name={item.name} chainId={item.chainId} tokenId={item.tokenId} />
                      <Dot size={10} tone={job ? 'quiet' : dotToneFor(step)} />
                      <Stack gap={3} className="min-w-0">
                        <Txt size={15} lead={20} weight="bold" tone="ink" className="block truncate">
                          {item.name}
                        </Txt>
                        <Txt
                          size={12}
                          lead={17}
                          tone="labels"
                          className="block truncate"
                        >
                          {job
                            ? `${item.category || 'General'} · priced on its own page as a job`
                            : `${item.category || 'General'} · about ${PRICE_USD} U per hire`}
                        </Txt>
                      </Stack>
                    </Row>
                    <Row align="center" gap={10}>
                      {job ? (
                        <Link
                          to={`/agents/${item.chainId}/${item.tokenId}`}
                          className="cursor-pointer text-[12px] leading-[17px] text-souk-data underline decoration-souk-steel/50 underline-offset-4 transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
                        >
                          Get price
                        </Link>
                      ) : (
                        <StepLabel step={step} error={steps[key]?.error} />
                      )}
                      {step === 'failed' && !running ? (
                        <Btn
                          kind="off"
                          onClick={() => handleRetry(key)}
                          style={{ height: 32, paddingLeft: 12, paddingRight: 12 }}
                        >
                          Retry
                        </Btn>
                      ) : null}
                      {!busy ? (
                        <button
                          type="button"
                          onClick={() => handleRemove(item)}
                          aria-label={`Remove ${item.name} from cart`}
                          className="cursor-pointer text-[12px] leading-[17px] text-souk-steel transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
                        >
                          Remove
                        </button>
                      ) : null}
                    </Row>
                  </Row>
                )
              })}
              <Rule hair />
              <Row justify="between" align="baseline" gap={12} className="flex-wrap">
                <Txt size={18} lead={26} weight="bold" tone="ink">
                  Total {total.toFixed(0)} U
                </Txt>
                <Txt size={12} lead={18} mono tone="labels">
                  ({directItems.length} agent{directItems.length === 1 ? '' : 's'} x ${PRICE_USD})
                </Txt>
              </Row>
              {jobItemCount > 0 ? (
                <Txt size={12} lead={18} tone="muted" className="block">
                  {jobItemCount === 1
                    ? 'One agent here sells as an ERC-8183 job. It is priced on its own page and not checked out here.'
                    : `${jobItemCount} agents here sell as ERC-8183 jobs. They are priced on their own pages and not checked out here.`}
                </Txt>
              ) : null}
              <Btn
                kind="primary"
                className="w-full"
                onClick={handleCheckout}
                disabled={busy || directItems.length === 0}
              >
                {connecting
                  ? 'Connecting wallet...'
                  : running
                    ? 'Running checkout...'
                    : directItems.length === 0
                      ? 'Nothing to check out'
                      : `Checkout ${directItems.length} agent${directItems.length === 1 ? '' : 's'}`}
              </Btn>
              {failedKeys.length > 0 && !running ? (
                <Btn
                  kind="off"
                  onClick={() =>
                    void runCheckout(
                      items.filter((i) => failedKeys.includes(`${i.chainId}/${i.tokenId}`)),
                    )
                  }
                >
                  Retry {failedKeys.length} failed hire{failedKeys.length === 1 ? '' : 's'}
                </Btn>
              ) : null}
              <Txt size={12} lead={18} tone="muted" className="block">
                One checkout, one signature per agent, settled direct to each seller. Agent Souk
                never pools or disburses funds.{address ? ` Paying from ${address}.` : ''}
              </Txt>
            </Stack>

            <Stack surface pad={[20, 22, 20, 22]} gap={10} className="w-[520px] shrink-0">
              <SectionHead title="What you are authorising" note="one signature per agent" />
              <Txt size={13} lead={20} tone="slate" className="block">
                {directItems.length} hire{directItems.length === 1 ? '' : 's'}, {directItems.length} signature
                {directItems.length === 1 ? '' : 's'}. Each pays its own agent directly, and neither can
                pull from your wallet again on its own.
              </Txt>
              {authRows.map((r) => (
                <Row key={r.key} align="start" gap={12}>
                  <Txt
                    size={10}
                    lead={16}
                    weight="bold"
                    upper
                    tone={r.highlighted ? 'data' : 'muted'}
                    className="w-[96px] shrink-0"
                  >
                    {r.key}
                  </Txt>
                  <Stack gap={2} className="min-w-0">
                    <Txt
                      mono
                      size={r.highlighted ? 13 : 12}
                      lead={r.highlighted ? 19 : 18}
                      weight={r.highlighted ? 'bold' : 'regular'}
                      tone={r.highlighted ? 'ink' : 'labels'}
                    >
                      {r.value}
                    </Txt>
                    <Txt size={11} lead={15} tone="steel">
                      {r.note}
                    </Txt>
                  </Stack>
                </Row>
              ))}
              <Rule hair />
              <Txt size={12} lead={18} tone="steel" className="block">
                A session capped at ${SESSION_SPEND_CAP_USD} that ends in {SESSION_HOURS} hours.
                Later calls draw on it until you revoke it, and a revoke is one signature that
                returns whatever is left.
              </Txt>
            </Stack>
          </Row>
          </Section>
        ) : (
          <Stack pad={[24, 0, 0, 0]}>
            <Stack surface pad={[20, 22, 20, 22]} gap={8}>
              <SoukMark size={30} />
              <Txt size={13} lead={19} weight="semibold" tone="ink">
                Your cart is empty.
              </Txt>
              <Link
                to="/agents"
                className="mt-4 inline-flex h-11 w-fit items-center justify-center rounded-[8px] bg-souk-data px-5 text-[14px] font-semibold leading-[20px] text-souk-canvas transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
              >
                Browse the market
              </Link>
            </Stack>
          </Stack>
        )}

        {summary.length > 0 ? (
          <Stack gap={12} pad={[20, 0, 0, 0]}>
            <SectionHead
              title="Order summary"
              note={`${summary.length} hire${summary.length === 1 ? '' : 's'} settled`}
            />
            <SummaryTable summary={summary} />
          </Stack>
        ) : null}

        {summary.some(([, r]) => !isOnchainSettlement(r.mode)) ? (
          <Stack gap={8} pad={[20, 0, 0, 0]}>
            <Rule />
            <Txt size={11} lead={17} mono tone="muted" className="block">
              A sandbox hash is derived from the payment id, so it is labelled rather than shown as a
              transaction.
            </Txt>
          </Stack>
        ) : null}
      </div>
    </div>
  )
}

// the table primitive prints plain text only, and a settlement that broadcast keeps
// its explorer anchor, so this one follows the receipt tables elsewhere in the port
function SummaryTable({ summary }: { summary: [string, Receipt][] }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-souk-edge bg-souk-surface1">
      <table className="w-full border-collapse">
        <colgroup>
          {SUMMARY_COLS.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-souk-surface2">
            {SUMMARY_HEADER.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="border-b border-r border-souk-hair text-left"
                style={{ padding: '8px 10px 8px 12px', height: 29 }}
              >
                <Txt size={10} lead={12} weight="bold" upper tone="steel">
                  {h}
                </Txt>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.map(([key, r]) => (
            <tr key={key}>
              <td
                className="border-b border-r border-souk-edge"
                style={{ padding: '7px 10px 7px 12px', height: 30 }}
              >
                <Txt size={13} lead={15} weight="semibold" tone="slate">
                  {r.name}
                </Txt>
              </td>
              <td
                className="border-b border-r border-souk-edge"
                style={{ padding: '7px 10px 7px 12px', height: 30 }}
              >
                <Txt size={13} lead={15} mono tone="ink">
                  {r.paymentId ? shortAddress(r.paymentId, 7) : '-'}
                </Txt>
              </td>
              <td
                className="border-b border-r border-souk-edge"
                style={{ padding: '7px 10px 7px 12px', height: 30 }}
              >
                {r.txHash ? (
                  isOnchainSettlement(r.mode) ? (
                    <a
                      href={`${explorerTxBase(r.chainId)}/tx/${r.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[13px] leading-[15px] text-souk-data underline decoration-souk-data/40 underline-offset-2 transition hover:decoration-souk-data"
                    >
                      tx {r.txHash.slice(0, 10)}...
                    </a>
                  ) : (
                    // labelled: the sandbox hash is derived from the payment id, not a transaction
                    <Txt size={13} lead={15} mono tone="steel">
                      settlement {r.txHash.slice(0, 10)}...
                    </Txt>
                  )
                ) : (
                  <Txt size={13} lead={15} mono tone="steel">
                    -
                  </Txt>
                )}
              </td>
              <td
                className="border-b border-r border-souk-edge"
                style={{ padding: '7px 10px 7px 12px', height: 30 }}
              >
                <Txt
                  size={13}
                  lead={15}
                  weight="semibold"
                  tone={r.mode ? MODE_TONE[r.mode] : 'steel'}
                >
                  {r.mode ?? 'unknown'}
                </Txt>
              </td>
              <td
                className="border-b border-r border-souk-edge"
                style={{ padding: '7px 10px 7px 12px', height: 30 }}
              >
                <Txt size={13} lead={15} tone="muted">
                  {r.receiptLoaded ? 'loaded' : 'no receipt'}
                </Txt>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StepLabel({ step, error }: { step: StepStatus; error?: string }) {
  if (step === 'failed') {
    return (
      <Txt size={11} lead={16} mono tone="steel" className="block max-w-[220px] text-right">
        {error ?? 'Failed.'}
      </Txt>
    )
  }
  return (
    <Txt size={11} lead={16} mono upper tone={step === 'done' ? 'data' : 'labels'}>
      {statusLabel[step]}
      {step === 'done' ? ' ✓' : ''}
    </Txt>
  )
}
