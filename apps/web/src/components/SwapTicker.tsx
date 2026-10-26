import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { formatUnits } from 'viem'
import { explorerTxBase } from '../lib/contracts'
import { readErc20Balance, readNativeBalance } from '../lib/mint'
import { withSendTimeout, waitForTransactionReceipt, type TransactionReceipt } from '../lib/register'
import {
  approveSwapCalldata,
  minimumOut,
  parseSwapAmount,
  quoteSwap,
  readAllowance,
  SWAP_CHAIN_ID,
  SWAP_SYMBOLS,
  SWAP_TOKENS,
  swapCalldata,
  type SwapQuote,
  type SwapSymbol,
} from '../lib/swap'
import { ensureBscChain, getProvider, setTargetChain } from '../lib/wallet'
import { connectWallet, sessionAccount, watchSession } from '../lib/wallet-session'

const GAS_BUFFER = 5_000_000_000_000_000n

function amountLabel(value: bigint | null, places = 6): string {
  if (value === null) return '--'
  const text = formatUnits(value, 18)
  const [whole, fraction = ''] = text.split('.')
  const cut = fraction.slice(0, places).replace(/0+$/, '')
  return cut ? `${whole}.${cut}` : whole
}

function errorText(error: unknown): string {
  if ((error as { code?: number } | null)?.code === 4001) return 'Request cancelled in the wallet.'
  const message = error instanceof Error ? error.message : String(error)
  if (/insufficient funds/i.test(message)) return 'Not enough BNB for the swap plus gas.'
  return message.length > 180 ? `${message.slice(0, 180)}...` : message
}

async function sendAndConfirm(
  provider: Awaited<ReturnType<typeof getProvider>>,
  from: string,
  tx: { to: string; data?: `0x${string}`; value?: string },
): Promise<`0x${string}`> {
  const hash = (await withSendTimeout(
    provider.request({ method: 'eth_sendTransaction', params: [{ from, ...tx }] }) as Promise<`0x${string}`>,
  )) as `0x${string}`
  const receipt = (await waitForTransactionReceipt(
    () =>
      provider.request({
        method: 'eth_getTransactionReceipt',
        params: [hash],
      }) as Promise<TransactionReceipt | null>,
  )) as TransactionReceipt | null
  if (!receipt) throw new Error(`Transaction ${hash} is still pending.`)
  if (receipt.status !== '0x1' && receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted.`)
  return hash
}

export function SwapTicker() {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState<SwapSymbol>('BNB')
  const [to, setTo] = useState<SwapSymbol>('$U')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [rate, setRate] = useState<bigint | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [balances, setBalances] = useState<Partial<Record<SwapSymbol, bigint | null>>>({})
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'approving' | 'swapping'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [hash, setHash] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  const fromToken = SWAP_TOKENS[from]
  const nativeIn = fromToken.address === null
  const balance = balances[from] ?? null
  const parsed = parseSwapAmount(amount)
  const insufficient = parsed !== null && balance !== null && parsed > balance
  const busy = phase !== 'idle'

  const refreshBalances = useCallback(async (who: string | null) => {
    if (!who) {
      setBalances({})
      return
    }
    const [bnb, wbnb, usdt, u] = await Promise.all([
      readNativeBalance(who as `0x${string}`, SWAP_CHAIN_ID),
      readErc20Balance(SWAP_TOKENS.WBNB.address as `0x${string}`, who as `0x${string}`, SWAP_CHAIN_ID),
      readErc20Balance(SWAP_TOKENS.USDT.address as `0x${string}`, who as `0x${string}`, SWAP_CHAIN_ID),
      readErc20Balance(SWAP_TOKENS['$U'].address as `0x${string}`, who as `0x${string}`, SWAP_CHAIN_ID),
    ])
    setBalances({ BNB: bnb, WBNB: wbnb, USDT: usdt, '$U': u })
  }, [])

  useEffect(() => {
    void sessionAccount().then(setAccount)
    return watchSession(setAccount)
  }, [])

  // balances are read as soon as a wallet is known, so the panel opens with
  // them instead of fetching on first open
  useEffect(() => {
    void refreshBalances(account)
  }, [account, refreshBalances])

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('agentsouk:open-swap', onOpen)
    return () => window.removeEventListener('agentsouk:open-swap', onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  // the rate is fetched on mount and whenever the pair flips, so the panel
  // opens already priced instead of waiting on a fetch after it is open
  useEffect(() => {
    let live = true
    const one = parseSwapAmount('1')
    if (one) {
      quoteSwap(from, to, one)
        .then((next) => {
          if (live) setRate(next?.amountOut ?? null)
        })
        .catch(() => {
          if (live) setRate(null)
        })
    }
    return () => {
      live = false
    }
  }, [from, to])

  useEffect(() => {
    if (!open) {
      setQuote(null)
      setQuoting(false)
      return
    }
    const value = parseSwapAmount(amount)
    if (!value || value <= 0n) {
      setQuote(null)
      setQuoting(false)
      return
    }
    let live = true
    setQuoting(true)
    const timer = window.setTimeout(() => {
      quoteSwap(from, to, value)
        .then((next) => {
          if (live) setQuote(next)
        })
        .catch(() => {
          if (live) setQuote(null)
        })
        .finally(() => {
          if (live) setQuoting(false)
        })
    }, 320)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [open, from, to, amount])

  function changeAmount(next: string) {
    const clean = next.replace(',', '.')
    if (clean === '' || /^\d*\.?\d*$/.test(clean)) {
      setAmount(clean)
      setError(null)
      setDone(null)
      setHash(null)
    }
  }

  function setMax() {
    const max =
      nativeIn && balance !== null
        ? balance > GAS_BUFFER
          ? balance - GAS_BUFFER
          : 0n
        : balance
    if (max !== null) changeAmount(amountLabel(max, 18).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''))
  }

  // picking the token already on the other side flips the pair rather than
  // leaving the two legs identical
  function pickFrom(next: SwapSymbol) {
    if (next === to) setTo(from)
    setFrom(next)
    setQuote(null)
    setRate(null)
    setError(null)
    setDone(null)
    setHash(null)
  }

  function pickTo(next: SwapSymbol) {
    if (next === from) setFrom(to)
    setTo(next)
    setQuote(null)
    setRate(null)
    setError(null)
    setDone(null)
    setHash(null)
  }

  function flip() {
    // carry the quoted value across, so 3000 $U becomes its BNB equivalent
    // instead of being reinterpreted as 3000 BNB
    const carry = quote !== null && !quoting && parsed !== null && quote.amountIn === parsed
    setAmount(quote && carry ? amountLabel(quote.amountOut, 8) : '')
    setFrom(to)
    setTo(from)
    setQuote(null)
    setRate(null)
    setError(null)
    setDone(null)
    setHash(null)
  }

  async function onSwap() {
    setError(null)
    setDone(null)
    setHash(null)
    if (!account) {
      setPhase('connecting')
      try {
        const who = await connectWallet()
        setAccount(who)
        await refreshBalances(who)
      } catch (next) {
        setError(errorText(next))
      } finally {
        setPhase('idle')
      }
      return
    }
    if (!quote || !parsed || parsed <= 0n) {
      setError('Enter an amount to swap.')
      return
    }
    if (insufficient) {
      setError(`Not enough ${from} in this wallet.`)
      return
    }
    setPhase('swapping')
    try {
      setTargetChain(SWAP_CHAIN_ID)
      await ensureBscChain()
      const provider = await getProvider()
      // the native coin is spent as value, not approved; every token leg needs
      // the router to be allowed to move it
      if (!nativeIn) {
        const allowance = await readAllowance(account, from)
        if (allowance === null) throw new Error(`Could not read the ${from} approval.`)
        if (allowance < parsed) {
          setPhase('approving')
          const approval = approveSwapCalldata(from, parsed)
          await sendAndConfirm(provider, account, { to: approval.to, data: approval.data })
        }
      }
      setPhase('swapping')
      const tx = swapCalldata({
        from,
        to,
        amountIn: parsed,
        amountOutMinimum: minimumOut(quote.amountOut),
        fee: quote.fee,
        recipient: account,
      })
      const swapHash = await sendAndConfirm(provider, account, tx)
      setHash(swapHash)
      setDone(`${from} swapped for ${to}.`)
      setAmount('')
      await refreshBalances(account)
    } catch (next) {
      setError(errorText(next))
    } finally {
      setPhase('idle')
    }
  }

  const label = busy
    ? phase === 'connecting'
      ? 'Connecting...'
      : phase === 'approving'
        ? `Approving ${from}...`
        : 'Swapping...'
    : !account
      ? 'Connect wallet'
      : insufficient
        ? `Not enough ${from}`
        : !parsed || parsed <= 0n
          ? 'Enter an amount'
          : quoting
            ? 'Finding a route...'
            : !quote
              ? 'No route found'
              : 'Swap'

  const pickerClass =
    'mt-1 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-2 py-1.5 text-sm font-semibold text-souk-ink outline-none focus:border-souk-sky'

  return (
    <div ref={rootRef} className="relative flex items-center">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-[0.75rem] transition hover:bg-souk-surface2"
      >
        <span aria-hidden="true" className="text-souk-data">
          &#8646;
        </span>
        <span className="text-souk-muted">Swap</span>
        <span className="font-semibold text-souk-ink">
          {from}/{to}
        </span>
      </button>

      <AnimatePresence>
        {open && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.99 }}
          transition={{ duration: reduceMotion ? 0.08 : 0.14, ease: 'easeOut' }}
          style={{ transformOrigin: 'bottom left' }}
          className="fixed bottom-16 left-3 z-[200] w-[min(92vw,356px)] origin-bottom rounded-none bg-[linear-gradient(117deg,var(--mast-wash),var(--color-souk-surface1))] p-4 text-souk-ink shadow-lg backdrop-blur-md ring-1 ring-white/10"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-souk-muted">
              Swap on BNB Chain
            </span>
            <button
              type="button"
              aria-label="Close swap"
              onClick={() => setOpen(false)}
              className="text-lg leading-none text-souk-muted transition hover:text-souk-ink"
            >
              &times;
            </button>
          </div>

          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <label className="block min-w-0">
              <span className="block text-[10px] uppercase tracking-wide text-souk-muted">You pay</span>
              <select
                aria-label="Token you pay"
                value={from}
                onChange={(event) => pickFrom(event.target.value as SwapSymbol)}
                className={pickerClass}
              >
                {SWAP_SYMBOLS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={flip}
              aria-label="Flip the pair"
              className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-full border border-souk-hair text-souk-data transition hover:bg-souk-surface2"
            >
              <span aria-hidden="true">&#8646;</span>
            </button>
            <label className="block min-w-0">
              <span className="block text-[10px] uppercase tracking-wide text-souk-muted">You receive</span>
              <select
                aria-label="Token you receive"
                value={to}
                onChange={(event) => pickTo(event.target.value as SwapSymbol)}
                className={pickerClass}
              >
                {SWAP_SYMBOLS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-2 rounded-[8px] border border-souk-hair bg-souk-surface2 px-3 py-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-souk-muted">
              <span>Amount</span>
              <span>
                Balance {amountLabel(balance, 5)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={amount}
                onChange={(event) => changeAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.0"
                className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-souk-ink outline-none placeholder:text-souk-muted"
              />
              <span className="text-xs font-semibold text-souk-ink">{from}</span>
              <button
                type="button"
                onClick={setMax}
                className="text-[10px] font-semibold text-souk-data transition hover:text-souk-ink"
              >
                MAX
              </button>
            </div>
          </div>

          <div className="mt-2 rounded-[8px] border border-souk-hair px-3 py-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-souk-muted">
              <span>You receive</span>
              <span>0.5% slippage</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-lg font-semibold text-souk-ink">
                {quote ? amountLabel(quote.amountOut) : quoting ? '...' : '--'}
              </span>
              <span className="text-xs font-semibold text-souk-ink">{to}</span>
            </div>
          </div>

          {rate !== null && (
            <p className="mt-2 text-[10px] text-souk-muted">
              1 {from} &asymp; {amountLabel(rate, 4)} {to}
            </p>
          )}

          <button
            type="button"
            disabled={busy || (Boolean(account) && (!quote || !parsed || parsed <= 0n || insufficient || quoting))}
            onClick={() => void onSwap()}
            className="mt-3 w-full rounded-none bg-souk-data px-3 py-2 text-sm font-semibold text-souk-canvas transition disabled:cursor-not-allowed disabled:opacity-45"
          >
            {label}
          </button>

          {error && <p className="mt-2 text-[11px] leading-4 text-souk-peach">{error}</p>}
          {done && <p className="mt-2 text-[11px] leading-4 text-souk-data">{done}</p>}
          {hash && (
            <a
              href={`${explorerTxBase(SWAP_CHAIN_ID)}${hash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-[10px] text-souk-data underline"
            >
              View transaction
            </a>
          )}
          <p className="mt-2 whitespace-normal break-words text-[10px] leading-4 text-souk-muted">
            BNB, WBNB, USDT and $U, routed through PancakeSwap v3. Network fee is paid in BNB.
          </p>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}

export default SwapTicker
