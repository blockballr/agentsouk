import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCart, removeFromCart, subscribe, type CartItem } from '../lib/cart'
import { connectWallet, ensureBscChain } from '../lib/wallet'
import { hireErrorText, runHire } from '../lib/hire'

const PRICE_USD = 2

type StepStatus = 'queued' | 'requirements' | 'signing' | 'settling' | 'done' | 'failed'

interface Step {
  status: StepStatus
  error?: string
}

interface Receipt {
  name: string
  paymentId?: string
  txHash?: string
}

const statusLabel: Record<Exclude<StepStatus, 'failed'>, string> = {
  queued: 'Queued',
  requirements: 'Preparing',
  signing: 'Signing',
  settling: 'Settling',
  done: 'Settled',
}

export function CartPage() {
  const [items, setItems] = useState<CartItem[]>(() => getCart())
  const [steps, setSteps] = useState<Record<string, Step>>({})
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({})
  const [running, setRunning] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const addressRef = useRef<string | null>(null)

  useEffect(() => subscribe(() => setItems(getCart())), [])

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
          [key]: { name: item.name, paymentId: outcome.paymentId, txHash: outcome.txHash },
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
    void runCheckout(items)
  }

  function handleRetry(key: string) {
    const item = items.find((i) => `${i.chainId}/${i.tokenId}` === key)
    if (item) void runCheckout([item])
  }

  const failedKeys = items
    .map((i) => `${i.chainId}/${i.tokenId}`)
    .filter((key) => steps[key]?.status === 'failed')
  const summary = Object.entries(receipts)
  const busy = running || connecting

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Hire cart</p>
      <h1 className="mt-4 font-serif text-[clamp(44px,7vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
        Cart.
      </h1>

      {notice ? (
        <p className="mt-8 border hairline border-slate-verdant/40 px-6 py-4 text-sm text-newsprint-gray">
          {notice}
        </p>
      ) : null}

      {summary.length > 0 ? (
        <div className="mt-10 border hairline border-slate-verdant/40 p-8">
          <h2 className="font-serif text-[28px] font-medium">Order summary</h2>
          <p className="micro mt-2 text-newsprint-gray">
            {summary.length} hire{summary.length === 1 ? '' : 's'} settled. Receipts recorded on the backend, one signature each.
          </p>
          <ul className="mt-6 divide-y divide-slate-verdant/40">
            {summary.map(([key, r]) => (
              <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-highlighter-green" aria-hidden="true">
                    <CheckGlyph />
                  </span>
                  <span className="text-sm font-medium text-press-black">{r.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-newsprint-gray">
                  {r.paymentId ? <span>paymentId {r.paymentId}</span> : null}
                  {r.txHash ? (
                    <a
                      href={`https://bscscan.com/tx/${r.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-highlighter-green underline-offset-4 hover:text-press-black focus-visible:outline-2 focus-visible:outline-highlighter-green"
                    >
                      tx {r.txHash.slice(0, 10)}...
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="mt-10 border hairline border-slate-verdant/40 px-10 py-20 text-center">
          <p className="font-serif text-[28px] font-medium">Your cart is empty.</p>
          <p className="mt-3 text-sm text-newsprint-gray">
            Queue a few agents on the market, then run one checkout.
          </p>
          <Link
            to="/agents"
            className="micro mt-8 inline-block rounded-[5px] bg-highlighter-green px-6 py-3 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
          >
            Browse the market
          </Link>
        </div>
      ) : (
        <div className="mt-10 border hairline border-slate-verdant/40">
          <ul className="divide-y divide-slate-verdant/40">
            {items.map((item) => {
              const key = `${item.chainId}/${item.tokenId}`
              const step = steps[key]?.status ?? 'queued'
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
                  <div className="flex min-w-0 items-center gap-4">
                    <StatusMark status={step} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-press-black">{item.name}</p>
                      <p className="micro mt-1 text-newsprint-gray">
                        {item.category || 'General'} - about ${PRICE_USD} USDC per hire
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <StepLabel step={step} error={steps[key]?.error} />
                    {step === 'failed' && !running ? (
                      <button
                        type="button"
                        onClick={() => handleRetry(key)}
                        className="micro rounded-[5px] border hairline border-slate-verdant/40 px-3 py-1.5 text-press-black transition hover:border-highlighter-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter-green"
                      >
                        Retry
                      </button>
                    ) : null}
                    {!busy ? (
                      <button
                        type="button"
                        onClick={() => handleRemove(item)}
                        aria-label={`Remove ${item.name} from cart`}
                        className="micro rounded-[5px] px-2 py-1.5 text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter-green"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t hairline border-slate-verdant/40 px-6 py-5">
            <p className="text-sm text-press-black">
              Total{' '}
              <span className="font-medium tabular-nums">
                ${(items.length * PRICE_USD).toFixed(0)} USDC
              </span>{' '}
              <span className="text-newsprint-gray">
                ({items.length} agent{items.length === 1 ? '' : 's'} x ${PRICE_USD})
              </span>
            </p>
            <button
              type="button"
              onClick={handleCheckout}
              disabled={busy}
              className="micro rounded-[5px] bg-highlighter-green px-6 py-3 text-typesetter-ink shadow-lg transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
            >
              {connecting ? 'Connecting wallet...' : running ? 'Running checkout...' : `Checkout ${items.length} agent${items.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {failedKeys.length > 0 && !running ? (
            <div className="border-t hairline border-slate-verdant/40 px-6 py-5">
              <button
                type="button"
                onClick={() =>
                  void runCheckout(
                    items.filter((i) => failedKeys.includes(`${i.chainId}/${i.tokenId}`)),
                  )
                }
                className="micro rounded-[5px] border hairline border-slate-verdant/40 px-4 py-2 text-press-black transition hover:border-highlighter-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter-green"
              >
                Retry {failedKeys.length} failed hire{failedKeys.length === 1 ? '' : 's'}
              </button>
            </div>
          ) : null}
        </div>
      )}

      <p className="micro mt-8 max-w-xl text-newsprint-gray">
        One checkout, one signature per agent, settled direct to each seller. Agent Souk never
        pools or disburses funds.
        {address ? ` Paying from ${address}.` : ''}
      </p>
    </section>
  )
}

function StatusMark({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-highlighter-green text-typesetter-ink"
        aria-hidden="true"
      >
        <CheckGlyph />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border hairline border-slate-verdant/40 text-newsprint-gray"
        aria-hidden="true"
      >
        <XGlyph />
      </span>
    )
  }
  return (
    <span
      className={`h-7 w-7 shrink-0 rounded-full border hairline ${
        status === 'queued'
          ? 'border-slate-verdant/45'
          : 'border-highlighter-green/60 motion-safe:animate-pulse'
      }`}
      aria-hidden="true"
    />
  )
}

function StepLabel({ step, error }: { step: StepStatus; error?: string }) {
  if (step === 'failed') {
    return <span className="max-w-[220px] text-right font-mono text-[11px] text-newsprint-gray">{error ?? 'Failed.'}</span>
  }
  return (
    <span className={`micro ${step === 'done' ? 'text-highlighter-green' : 'text-newsprint-gray'}`}>
      {statusLabel[step]}
      {step === 'done' ? ' ✓' : ''}
    </span>
  )
}

function CheckGlyph() {
  return (
    <svg width="12" height="9" viewBox="0 0 14 10" fill="none" aria-hidden="true">
      <path d="M1 5l4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function XGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
