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
  SWAP_SYMBOL,
  SWAP_TOKEN,
  swapCalldata,
  type SwapDirection,
  type SwapQuote,
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
  const [direction, setDirection] = useState<SwapDirection>('bnb-to-u')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [rate, setRate] = useState<bigint | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [bnbBalance, setBnbBalance] = useState<bigint | null>(null)
  const [uBalance, setUBalance] = useState<bigint | null>(null)
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'approving' | 'swapping'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [hash, setHash] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  const fromSymbol = direction === 'bnb-to-u' ? 'BNB' : SWAP_SYMBOL
  const toSymbol = direction === 'bnb-to-u' ? SWAP_SYMBOL : 'BNB'
  const balance = direction === 'bnb-to-u' ? bnbBalance : uBalance
  const parsed = parseSwapAmount(amount)
  const insufficient = parsed !== null && balance !== null && parsed > balance
  const busy = phase !== 'idle'

  const refreshBalances = useCallback(async (who: string | null) => {
    if (!who) {
      setBnbBalance(null)
      setUBalance(null)
      return
    }
    const [bnb, token] = await Promise.all([
      readNativeBalance(who as `0x${string}`, SWAP_CHAIN_ID),
      readErc20Balance(SWAP_TOKEN, who as `0x${string}`, SWAP_CHAIN_ID),
    ])
    setBnbBalance(bnb)
    setUBalance(token)
  }, [])

  useEffect(() => {
    void sessionAccount().then(setAccount)
    return watchSession(setAccount)
  }, [])

  useEffect(() => {
    if (open) void refreshBalances(account)
  }, [open, account, refreshBalances])

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

  useEffect(() => {
    if (!open) {
      setRate(null)
      return
    }
    let live = true
    const one = parseSwapAmount('1')
    if (one) {
      quoteSwap(direction, one)
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
  }, [open, direction])

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
      quoteSwap(direction, value)
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
  }, [open, direction, amount])

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
      direction === 'bnb-to-u' && bnbBalance !== null
        ? bnbBalance > GAS_BUFFER
          ? bnbBalance - GAS_BUFFER
          : 0n
        : uBalance
    if (max !== null) changeAmount(amountLabel(max, 18).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''))
  }

  function flip() {
    // carry the quoted value across, so 3000 $U becomes its BNB equivalent
    // instead of being reinterpreted as 3000 BNB
    const carry = quote !== null && !quoting && parsed !== null && quote.amountIn === parsed
    setAmount(quote && carry ? amountLabel(quote.amountOut, 8) : '')
    setDirection((current) => (current === 'bnb-to-u' ? 'u-to-bnb' : 'bnb-to-u'))
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
      setError(`Not enough ${fromSymbol} in this wallet.`)
      return
    }
    setPhase('swapping')
    try {
      setTargetChain(SWAP_CHAIN_ID)
      await ensureBscChain()
      const provider = await getProvider()
      if (direction === 'u-to-bnb') {
        const allowance = await readAllowance(account)
        if (allowance === null) throw new Error('Could not read the $U approval.')
        if (allowance < parsed) {
          setPhase('approving')
          await sendAndConfirm(provider, account, {
            to: SWAP_TOKEN,
            data: approveSwapCalldata(parsed),
          })
        }
      }
      setPhase('swapping')
      const tx = swapCalldata({
        direction,
        amountIn: parsed,
        amountOutMinimum: minimumOut(quote.amountOut),
        fee: quote.fee,
        recipient: account,
      })
      const swapHash = await sendAndConfirm(provider, account, tx)
      setHash(swapHash)
      setDone(`${fromSymbol} swapped for ${toSymbol}.`)
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
        ? `Approving ${SWAP_SYMBOL}...`
        : 'Swapping...'
    : !account
      ? 'Connect wallet'
      : insufficient
        ? `Not enough ${fromSymbol}`
        : !parsed || parsed <= 0n
          ? 'Enter an amount'
          : quoting
            ? 'Finding a route...'
            : !quote
              ? 'No route found'
              : 'Swap'

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
          BNB/{SWAP_SYMBOL}
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
          className="fixed bottom-[44px] left-3 z-[70] w-[min(92vw,356px)] rounded-[12px] border border-souk-hair bg-souk-surface1 p-4 shadow-2xl"
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

          <button
            type="button"
            onClick={flip}
            className="mt-3 flex w-full items-center justify-between rounded-[8px] border border-souk-hair bg-souk-surface2 px-3 py-2 text-left"
          >
            <span>
              <span className="block text-[10px] uppercase tracking-wide text-souk-muted">You pay</span>
              <span className="text-sm font-semibold text-souk-ink">{fromSymbol}</span>
            </span>
            <span aria-hidden="true" className="text-souk-data">
              &#8646;
            </span>
            <span className="text-right">
              <span className="block text-[10px] uppercase tracking-wide text-souk-muted">You receive</span>
              <span className="text-sm font-semibold text-souk-ink">{toSymbol}</span>
            </span>
          </button>

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
              <span className="text-xs font-semibold text-souk-ink">{fromSymbol}</span>
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
              <span className="text-xs font-semibold text-souk-ink">{toSymbol}</span>
            </div>
          </div>

          {rate !== null && (
            <p className="mt-2 text-[10px] text-souk-muted">
              1 {fromSymbol} &asymp; {amountLabel(rate, 4)} {toSymbol}
            </p>
          )}

          <button
            type="button"
            disabled={busy || (Boolean(account) && (!quote || !parsed || parsed <= 0n || insufficient || quoting))}
            onClick={() => void onSwap()}
            className="mt-3 w-full rounded-[8px] bg-souk-data px-3 py-2 text-sm font-semibold text-souk-canvas transition disabled:cursor-not-allowed disabled:opacity-45"
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
          <p className="mt-2 text-[10px] leading-4 text-souk-muted">
            Routed through PancakeSwap v3. Network fee is paid in BNB.
          </p>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}

export default SwapTicker
