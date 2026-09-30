import { useCallback, useEffect, useState } from 'react'
import { mintRequestMessage } from '@agora/core'
import {
  canAffordHire,
  isTestnet,
  MINT_PER_CLICK,
  readErc20Balance,
  SUSD_ADDRESS,
  watchSusd,
} from '../lib/mint'
import { connectWallet, getProvider } from '../lib/wallet'

type Phase = 'idle' | 'reading' | 'minting' | 'done' | 'error'

const DEFAULT_HIRE_PRICE = 2_000_000_000_000_000_000n // 2 sUSD

// injected once per mount; the shake is driven by an iteration count so repeated failures re-trigger it
const SHAKE_KEYFRAMES = `@keyframes shake{0%,100%{transform:translateX(0)}15%{transform:translateX(-6px)}30%{transform:translateX(6px)}45%{transform:translateX(-4px)}60%{transform:translateX(4px)}80%{transform:translateX(-2px)}}`

// 0 has to render as "0 sUSD"; trimming the fraction to nothing left a bare "sUSD"
function formatSUsd(wei: bigint): string {
  const whole = wei / 10n ** 18n
  if (whole > 0n) return `${whole} sUSD`
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  if (!frac) return '0 sUSD'
  return `0.${frac.slice(0, 4)} sUSD`
}

/** Lets a participant with an empty wallet fund itself before hiring; renders nothing off testnet. */
export function TestTokens({
  chainId,
  account,
  priceWei = DEFAULT_HIRE_PRICE,
  onShortfall,
  nudge,
}: {
  chainId: number
  account: string | null
  priceWei?: bigint
  onShortfall?: (short: boolean) => void
  nudge?: number
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [balance, setBalance] = useState<bigint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  // set when this modal did the connecting, so the balance re-reads immediately
  const [localAccount, setLocalAccount] = useState<string | null>(null)
  const [minted, setMinted] = useState(false)
  const [tokenAdded, setTokenAdded] = useState<boolean | null>(null)
  const addr = account ?? localAccount

  // a mint is a broadcast, not a state change, so poll until the balance moves
  const waitForBalance = useCallback(
    async (who: string) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((r) => setTimeout(r, 1500))
        const next = await readErc20Balance(SUSD_ADDRESS, who as `0x${string}`, chainId)
        if (next !== null) setBalance(next)
        if (next !== null && next > 0n) return
      }
    },
    [chainId],
  )

  const enabled = isTestnet(chainId)

  const read = useCallback(async () => {
    if (!addr) return
    setPhase('reading')
    setError(null)
    try {
      setBalance(await readErc20Balance(SUSD_ADDRESS, addr as `0x${string}`, chainId))
    } catch (e) {
      setError((e as Error).message)
    }
    setPhase('idle')
  }, [addr, chainId])

  useEffect(() => {
    if (open) void read()
  }, [open, read])

  // probe the balance on connect so the affordance only reaches someone who cannot afford a hire
  useEffect(() => {
    if (!addr) {
      setBalance(null)
      return
    }
    let cancelled = false
    void (async () => {
      const next = await readErc20Balance(SUSD_ADDRESS, addr as `0x${string}`, chainId)
      if (!cancelled) setBalance(next)
    })()
    return () => {
      cancelled = true
    }
  }, [addr, chainId])

  const shortOnTokens = balance !== null && !canAffordHire(balance, priceWei)
  const shouldOffer = enabled && !!addr && shortOnTokens

  if (shouldOffer && typeof document !== 'undefined' && !document.getElementById('tk-shake')) {
    const style = document.createElement('style')
    style.id = 'tk-shake'
    style.textContent = SHAKE_KEYFRAMES
    document.head.appendChild(style)
  }

  useEffect(() => {
    onShortfall?.(shortOnTokens)
  }, [shortOnTokens, onShortfall])

  if (!shouldOffer) return null

  const mint = async () => {
    setError(null)
    setTxHash(null)
    try {
      // the visitor signs a free message and we pay the gas, so a wallet holding zero BNB can still start
      const addr = account ?? localAccount ?? (await connectWallet())
      if (!account) setLocalAccount(addr)
      setPhase('minting')

      const expires = Math.floor(Date.now() / 1000) + 15 * 60
      const nonce = `${expires}-${addr.slice(2, 10).toLowerCase()}`
      const fields = {
        address: addr.toLowerCase(),
        amount: MINT_PER_CLICK.toString(),
        nonce,
        expires,
      }
      const provider = await getProvider()
      const signature = (await provider.request({
        method: 'personal_sign',
        params: [mintRequestMessage(fields), addr],
      })) as string

      const res = await fetch('/api/tokens/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, signature }),
      })
      const body = (await res.json()) as {
        success: boolean
        error?: string
        txHash?: string
      }
      if (!res.ok || !body.success) {
        setError(body.error ?? 'We could not mint right now. Please try again.')
        setPhase('error')
        return
      }
      setTxHash(body.txHash ?? null)
      setPhase('done')
      setMinted(true)

      // offer to display the token, or a freshly minted balance stays invisible
      void watchSusd(provider).then(setTokenAdded)

      // broadcast but not yet mined, so poll until the balance moves
      void waitForBalance(addr)
    } catch (e) {
      const err = e as Error & { code?: number }
      if (err.code === 4001) {
        setError('You cancelled the signature in your wallet, so nothing was minted.')
      } else {
        setError('We could not reach our server. Check your connection and try again.')
      }
      setPhase('error')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={nudge ? { animation: `shake 0.45s ${nudge}` } : undefined}
        className="micro mt-3 w-full rounded-[5px] border border-highlighter-green bg-highlighter-green/15 px-4 py-2.5 text-center text-press-black transition hover:bg-highlighter-green/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        {shortOnTokens ? (
          // .micro uppercases its text, which would rewrite the sUSD symbol
          <>
            Not enough <span className="normal-case">sUSD</span> to hire. Get 10 free.
          </>
        ) : (
          <>
            New here? Get 10 test <span className="normal-case">sUSD</span>
          </>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          {/* a solid sheet of the page's own paper: the see-through glass turned muddy grey on the light theme */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="test-tokens-title"
            className="relative w-full max-w-md rounded-[14px] border border-press-black/20 bg-bone-white p-6 text-typesetter-ink shadow-[0_24px_60px_-16px_rgba(0,0,0,0.45)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="test-tokens-title" className="relative font-serif text-[24px] font-medium tracking-[-0.02em]">
              Get test <span className="normal-case">sUSD</span>
            </h3>
            <p className="relative mt-2 text-sm leading-relaxed text-newsprint-gray">
              Free tokens for hiring here. You sign a message and we pay the gas.
            </p>

            <dl className="relative mt-4 space-y-2 rounded-[10px] border hairline border-slate-verdant/30 bg-highlighter-green/5 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-newsprint-gray">Your balance</dt>
                <dd className="font-mono">
                  {!addr ? 'no wallet connected' : phase === 'reading' ? 'reading' : balance === null ? 'unavailable' : formatSUsd(balance)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-newsprint-gray">A hire costs</dt>
                <dd className="font-mono">{formatSUsd(priceWei)}</dd>
              </div>
            </dl>


            {error && (
              <p role="alert" className="relative mt-3 rounded-[8px] border border-press-black/25 p-3 text-sm text-press-black">
                {error}
              </p>
            )}

            {minted && (
              <p className="relative mt-3 text-sm text-newsprint-gray">Minted. Add sUSD to your wallet to see the balance.</p>
            )}

            <div className="relative mt-5 flex flex-col gap-3">
              {minted && (
                <button
                  type="button"
                  onClick={() => void mint()}
                  className="micro w-full rounded-[5px] border hairline border-press-black/40 px-6 py-3 text-center text-press-black transition hover:bg-highlighter-green/15"
                >
                  Mint 10 more
                </button>
              )}
              {minted && tokenAdded === false && (
                <p className="text-xs leading-relaxed text-newsprint-gray">
                  Your wallet did not add sUSD itself. Add it with the address below.
                </p>
              )}
              {!minted && (
                <button
                  type="button"
                  disabled={phase === 'minting' || phase === 'reading'}
                  onClick={() => void mint()}
                  className="micro w-full rounded-[5px] bg-highlighter-green px-6 py-4 text-on-highlighter transition hover:brightness-95 disabled:opacity-60"
                >
                  {phase === 'minting' ? (
                    'Sign the message in your wallet'
                  ) : addr ? (
                    <>
                      Mint 10 <span className="normal-case">sUSD</span>, free
                    </>
                  ) : (
                    'Connect wallet to mint'
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="micro w-full px-4 py-2 text-center text-newsprint-gray transition hover:text-press-black"
              >
                Close
              </button>
            </div>

            <details className="relative mt-2 text-xs leading-relaxed text-newsprint-gray">
              <summary className="cursor-pointer transition hover:text-press-black">What is sUSD?</summary>
              <p className="mt-2">
                A token we deployed on BSC testnet for the campaign. It has no value, hires here settle in it,
                and nothing touches mainnet.
              </p>
            </details>

            {txHash && (
              <p className="relative mt-3 break-all font-mono text-[10px] text-newsprint-gray">
                {txHash}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
