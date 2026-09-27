import { useCallback, useEffect, useState } from 'react'
import { mintRequestMessage } from '@agora/core'
import {
  canAffordHire,
  isTestnet,
  MINT_PER_CLICK,
  readErc20Balance,
  readNativeBalance,
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
  const [native, setNative] = useState<bigint | null>(null)
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
      const [tokens, nativeHex] = await Promise.all([
        readErc20Balance(SUSD_ADDRESS, addr as `0x${string}`, chainId),
        readNativeBalance(addr as `0x${string}`, chainId),
      ])
      setBalance(tokens)
      setNative(nativeHex)
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

  const outOfGas = native !== null && native === 0n

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={nudge ? { animation: `shake 0.45s ${nudge}` } : undefined}
        className="micro mt-3 w-full rounded-[5px] border border-highlighter-green/70 bg-highlighter-green/10 px-4 py-2 text-center text-highlighter-green transition hover:bg-highlighter-green/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter-green"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          {/* Liquid glass: one set of classes serves both themes, and the scrim is plain black. */}
          <div
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/15 bg-bone-white/70 p-6 text-typesetter-ink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_24px_60px_-12px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-16 h-32 bg-gradient-to-b from-white/25 to-transparent"
            />
            <h3 className="relative font-serif text-[22px] font-medium">Test tokens</h3>
            <p className="relative mt-3 text-sm leading-relaxed text-newsprint-gray">
              Hires on this deployment settle in <strong>sUSD</strong>, a token we deployed on
              BSC testnet for the campaign. It has no value, and we pay for the mint, so you need
              no BNB and no testnet funds to get started. Nothing here touches mainnet.
            </p>

            <dl className="relative mt-4 space-y-2 text-sm">
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

            {!addr && (
              <p className="relative mt-3 text-sm text-newsprint-gray">
                No wallet connected yet. You will be asked to connect, then to sign one message.
                There is no transaction and no gas, so this is free even with an empty wallet.
              </p>
            )}

            {shortOnTokens && !outOfGas && (
              <p className="relative mt-3 text-sm text-newsprint-gray">
                You are short for a hire. Minting is a transaction, so it costs a little BNB in
                gas, but you do not pay any BNB when you hire.
              </p>
            )}

            {outOfGas && (
              <p className="relative mt-3 text-sm text-newsprint-gray">
                This wallet holds no BNB, which does not matter here: you sign a message and we pay
                for the mint, so the tokens are free either way.
              </p>
            )}

            {error && <p className="relative mt-3 text-sm text-press-black">{error}</p>}

            {minted && (
              <p className="relative mt-3 text-sm text-newsprint-gray">
                Tokens minted. They will appear in your wallet once you add the token there.
              </p>
            )}

            <div className="relative mt-5 flex flex-col gap-3">
              {minted && (
                <button
                  type="button"
                  onClick={() => void mint()}
                  className="micro w-full rounded-[5px] border hairline border-slate-verdant/50 px-6 py-3 text-center text-newsprint-gray transition hover:text-press-black"
                >
                  Mint 10 more
                </button>
              )}
              {minted && tokenAdded === false && (
                <p className="text-xs leading-relaxed text-newsprint-gray">
                  Your wallet did not add sUSD automatically. Add the token manually with the
                  address below and your balance will show.
                </p>
              )}
              {!minted && (
                <button
                  type="button"
                  disabled={phase === 'minting' || phase === 'reading'}
                  onClick={() => void mint()}
                  className="micro w-full rounded-[5px] bg-highlighter-green px-6 py-4 text-typesetter-ink transition hover:brightness-95 disabled:opacity-60"
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
                className="micro w-full px-4 py-2 text-center text-newsprint-gray"
              >
                Close
              </button>
            </div>

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
