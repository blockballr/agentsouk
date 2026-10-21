import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { decodeFunctionResult, encodeFunctionData, formatUnits, parseUnits } from 'viem'
import {
  approveCalldata,
  checkAmount,
  checkSlippage,
  expiryFor,
  EXPIRY_PRESETS,
  MAX_SLIPPAGE_BPS,
  MAX_TERM_SECONDS,
  openCalldata,
  vaultFor,
  vaultTokenA,
  vaultTokenB,
  withdrawCalldata,
  wrapCalldata,
  type VaultHire,
} from '../lib/vault'
import { chainIdToHex, ensureBscChain, getProvider, setTargetChain } from '../lib/wallet'
import { useConnectedAccount } from '../lib/use-connected-account'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from '../lib/register'
import { explorerAddressUrl } from '../lib/contracts'
import { ratedHires } from '../lib/rating'
import { getVaultExecutor } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { RateAgent } from '../components/RateAgent'
import { ResultBox } from '../components/ui'
import {
  Stack,
  Row,
  Txt,
  Pill,
  Dot,
  SectionHead,
  Btn,
  Rule,
  Label,
  SoukMark,
  AgentAvatar,
} from '../components/souk'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

const CHAINS: Record<number, { id: number; label: string; rpc: string; explorer: string }> = {
  56: { id: 56, label: 'BNB Smart Chain', rpc: 'https://bsc-dataseed.bnbchain.org', explorer: 'https://bscscan.com/tx/' },
  97: { id: 97, label: 'BSC testnet', rpc: 'https://bsc-testnet-rpc.publicnode.com', explorer: 'https://testnet.bscscan.com/tx/' },
}

interface Prefill {
  name: string | null
  wallet: string | null
}

// the named agent comes from the wallet the registry record declares, so the
// hire names the same address the listing already pays. The chain is the one the
// url asked for, because a listing's identity is only true on its own chain.
async function loadPrefill(chainId: string, tokenId: string): Promise<Prefill> {
  try {
    const chain = Number(chainId) > 0 ? Number(chainId) : 56
    const res = await fetch(`${API_BASE}/agents/${chain}/${tokenId}`)
    const body = await res.json().catch(() => null)
    const agent = body?.data ?? body
    return { name: agent?.name ?? null, wallet: agent?.agent_wallet ?? agent?.owner_address ?? null }
  } catch {
    return { name: null, wallet: null }
  }
}

function short(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

async function sendAndConfirm(provider: Awaited<ReturnType<typeof getProvider>>, from: string, tx: { to: string; data?: `0x${string}`; value?: string }, label: string): Promise<string> {
  const hash = (await withSendTimeout(
    provider.request({ method: 'eth_sendTransaction', params: [{ from, ...tx }] }) as Promise<`0x${string}`>,
  )) as `0x${string}`
  const receipt = (await waitForTransactionReceipt(
    () => provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as Promise<TransactionReceipt | null>,
  )) as TransactionReceipt | null
  if (!receipt || receipt.status !== '0x1' && receipt.status !== 'success') {
    throw new Error(`${label} did not confirm. ${hash}`)
  }
  return hash
}

async function readBytes(provider: Awaited<ReturnType<typeof getProvider>>, to: string, data: `0x${string}`): Promise<`0x${string}`> {
  return (await provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] })) as `0x${string}`
}

function uintWord(data: `0x${string}`): bigint {
  return data === '0x' || data.length < 3 ? 0n : BigInt(data)
}

export default function VaultHirePage() {
  const params = useParams()
  const tokenId = params.tokenId ?? ''
  // the chain the url asked for, so a listing's identity is read from its own chain
  const requestedChain = Number(params.chainId) > 0 ? Number(params.chainId) : 56
  const CHAIN = CHAINS[requestedChain] ?? CHAINS[56]

  const account = useConnectedAccount()
  const { t } = useI18n()
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const [manualAgent, setManualAgent] = useState('')
  const [tokenChoice, setTokenChoice] = useState<'WBNB' | 'USDT'>('WBNB')
  const [amount, setAmount] = useState('0.01')
  const [expiryIndex, setExpiryIndex] = useState(1)
  const [slippage, setSlippage] = useState(500)
  const [caps, setCaps] = useState<{ capA: string; capB: string } | null>(null)
  const [hires, setHires] = useState<VaultHire[] | null>(null)
  const [hiresError, setHiresError] = useState<string | null>(null)
  const [hireIds, setHireIds] = useState<bigint[] | null>(null)
  useEffect(() => {
    if (hires && hires.some((h) => !h.open)) {
      setVaultRated(ratedHires().get(`vault:${requestedChain}:${tokenId}`))
    }
  }, [hires, requestedChain, tokenId])
  const [vaultRated, setVaultRated] = useState<number | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [executor, setExecutor] = useState<{ kind: 'rawkey' | 'altana'; address: string } | null | undefined>(undefined)
  const [executorUnread, setExecutorUnread] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const token = tokenChoice === 'WBNB' ? vaultTokenA(requestedChain) : vaultTokenB(requestedChain)
  const vault = vaultFor(requestedChain)
  const agentAddress = prefill?.wallet && prefill.wallet !== '0x0000000000000000000000000000000000000000' ? prefill.wallet : manualAgent.trim()

  // The pairing is a fact the page can check, not a claim it can make: the
  // named agent only moves a hire if it is the wallet the executor trades from.
  const pairing: 'none' | 'reading' | 'unread' | 'no-executor' | 'match' | 'mismatch' =
    !agentAddress
      ? 'none'
      : executor === undefined
        ? 'reading'
        : executorUnread
          ? 'unread'
          : executor === null
            ? 'no-executor'
            : agentAddress.toLowerCase() === executor.address.toLowerCase()
              ? 'match'
              : 'mismatch'
  const pairingLabel =
    pairing === 'match'
      ? t('vault.pair.match')
      : pairing === 'mismatch'
        ? t('vault.pair.mismatch')
        : pairing === 'no-executor'
          ? t('vault.pair.noExecutor')
          : pairing === 'unread'
            ? t('vault.unread')
            : pairing === 'reading'
              ? t('vault.readingExecutor')
              : t('vault.notNamed')

  useEffect(() => {
    let alive = true
    getVaultExecutor()
      .then((value) => {
        if (alive) {
          setExecutor(value)
          setExecutorUnread(false)
        }
      })
      .catch(() => {
        if (alive) {
          setExecutor(null)
          setExecutorUnread(true)
        }
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (tokenId) loadPrefill(params.chainId ?? '56', tokenId).then(setPrefill)
  }, [params.chainId, tokenId])

  useEffect(() => {
    if (!account || !vault) return
    let alive = true
    ;(async () => {
      const provider = await getProvider()
      try {
        const capA = uintWord(await readBytes(provider, vault, encodeFunctionData({ abi: [{ name: 'capA', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const, functionName: 'capA', args: [] })))
        const capB = uintWord(await readBytes(provider, vault, encodeFunctionData({ abi: [{ name: 'capB', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const, functionName: 'capB', args: [] })))
        if (alive) setCaps({ capA: formatUnits(capA, 18), capB: formatUnits(capB, 18) })
      } catch {
        if (alive) setCaps(null)
      }
    })()
    return () => { alive = false }
  }, [account, vault])

  async function refresh() {
    if (!account || !vault) return
    setHiresError(null)
    const provider = await getProvider()
    try {
      const idsData = await readBytes(provider, vault, encodeFunctionData({ abi: [{ name: 'hiresOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'buyer', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }] }] as const, functionName: 'hiresOf', args: [account as `0x${string}`] }))
      const decoded = decodeFunctionResult({ abi: [{ name: 'hiresOf', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256[]' }] }] as const, functionName: 'hiresOf', data: idsData }) as bigint[]
      setHireIds(decoded)
      const found: VaultHire[] = []
      for (const id of decoded) {
        const hireData = await readBytes(provider, vault, encodeFunctionData({ abi: [{ name: 'hire', type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] }] as const, functionName: 'hire', args: [id] }))
        const hire = decodeFunctionResult({ abi: [{ name: 'hire', type: 'function', stateMutability: 'view', inputs: [], outputs: [
          { type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'uint16' }, { type: 'bool' },
          { type: 'uint256' }, { type: 'uint256' }, { type: 'uint160' }, { type: 'uint24' }, { type: 'uint256' },
        ] }] as const, functionName: 'hire', data: hireData }) as readonly unknown[]
        found.push({
          buyer: String(hire[0]),
          agent: String(hire[1]),
          expiry: Number(hire[2]),
          maxSlippageBps: Number(hire[3]),
          open: !!hire[4],
          balanceA: formatUnits(hire[5] as bigint, 18),
          balanceB: formatUnits(hire[6] as bigint, 18),
          refPriceX96: String(hire[7]),
          fee: Number(hire[8]),
        })
      }
      setHires(found)
    } catch (e) {
      setHiresError((e as Error).message)
    }
  }

  useEffect(() => {
    if (!account) {
      setHires(null)
      setHiresError(null)
      return
    }
    refresh()
  }, [account])

  async function ensureChain() {
    setTargetChain(requestedChain)
    const chain = await ensureBscChain()
    if (chain?.toLowerCase() !== chainIdToHex(requestedChain)) {
      throw new Error(`Switch the wallet to ${CHAIN.label} for this vault.`)
    }
  }

  function logLine(h: string) {
    setLines((l) => [...l, h])
  }

  async function openHire() {
    setFormError(null)
    if (!vault) return setFormError(`No vault is configured for ${CHAIN.label}.`)
    if (!account) return setFormError('Connect a wallet before opening a hire.')
    if (!token) return setFormError('This vault has no bound deposit token.')
    const slErr = checkSlippage(slippage)
    const cap = tokenChoice === 'WBNB' ? caps?.capA ?? null : caps?.capB ?? null
    const amErr = checkAmount(amount, cap)
    if (slErr || amErr) return setFormError(slErr ?? amErr ?? 'Check the form.')
    if (!agentAddress) return setFormError('Name the agent wallet, or open this page from the agent card.')
    try {
      setBusy('open')
      await ensureChain()
      const provider = await getProvider()
      if (tokenChoice === 'WBNB') {
        logLine('Step 1: wrap the tBNB into WBNB, a deposit the panel names before the wallet shows it.')
        const wrapped = await sendAndConfirm(provider, account, { to: token.address, data: wrapCalldata(), value: '0x' + parseUnits(amount, 18).toString(16) }, 'wrap')
        logLine(`Wrapped. ${CHAIN.explorer}${wrapped}`)
      }
      logLine(`Step 2: approve exactly ${amount} ${token.symbol} to the vault, no blanket number.`)
      const approved = await sendAndConfirm(provider, account, { to: token.address, data: approveCalldata(vault, amount, token.decimals) }, 'approve')
      logLine(`Approved. ${CHAIN.explorer}${approved}`)
      logLine('Step 3: open the hire: names the agent, the deposit, the expiry, the slippage ceiling, the fee tier.')
      const expiry = expiryFor(EXPIRY_PRESETS[expiryIndex].days)
      const opened = await sendAndConfirm(provider, account, { to: vault, data: openCalldata(agentAddress, token.address, amount, token.decimals, expiry, slippage, 500) }, 'open')
      logLine(`Opened. ${CHAIN.explorer}${opened}`)
      await refresh()
    } catch (e) {
      setFormError((e as Error).message)
      logLine((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function withdrawHire(id: bigint) {
    if (!account || !vault) return
    try {
      setBusy(`withdraw ${id}`)
      await ensureChain()
      const provider = await getProvider()
      const hash = await sendAndConfirm(provider, account, { to: vault, data: withdrawCalldata(id) }, 'withdraw')
      logLine(`Hire ${id} closed: every balance came back. ${CHAIN.explorer}${hash}`)
      await refresh()
    } catch (e) {
      logLine((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // cap text waits on the read, the pair itself is pinned in lib/vault
  const capFor = (symbol: string) =>
    caps ? `${symbol === 'WBNB' ? caps.capA : caps.capB} per deposit` : 'read when the wallet connects'

  const termDays = MAX_TERM_SECONDS / 86_400

  const termLabel = (days: number | null) =>
    days === null ? t('vault.term.until') : days === 1 ? t('vault.term.day') : t('vault.term.days', { days })

  return (
    <div className="mx-auto min-h-screen bg-souk-canvas px-4 pb-28 text-souk-ink lg:px-8 lg:pb-14">
      <div className="pt-8">
        <Link
          to={tokenId ? `/agents/${requestedChain}/${tokenId}` : '/agents'}
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-souk-steel transition hover:text-souk-ink"
        >
          {tokenId ? t('vault.backAgent') : t('vault.backMarket')}
        </Link>
        <Stack gap={10} className="mt-5">
          <Row gap={8} align="center" className="flex-wrap">
            <Txt size={11} lead={16} mono upper tone="data">
              {t('vault.hireKicker')}
            </Txt>
            <span className="text-souk-muted">/</span>
            <Txt size={11} lead={16} mono upper tone="steel">
              {CHAIN.label} {CHAIN.id}
            </Txt>
            <span className="text-souk-muted">/</span>
            <Txt size={11} lead={16} mono upper tone="steel">
              {vault ? short(vault) : 'no vault'}
            </Txt>
            {tokenId ? (
              <>
                <span className="text-souk-muted">/</span>
                <Txt size={11} lead={16} mono upper tone="steel">
                  token #{tokenId}
                </Txt>
              </>
            ) : null}
          </Row>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="m-0 max-w-[900px]">
                <Txt size={34} lead={42} display weight="bold" tone="ink">
                  {t('vault.title')}
                </Txt>
              </h1>
              <Txt size={14} lead={22} tone="slate" className="mt-3 block max-w-[720px]">
                {t('vault.deck')}
              </Txt>
            </div>
            <Row gap={8} align="center" className="shrink-0 flex-wrap">
              <Pill variant={vault ? 'keep' : 'warn'}>{vault ? t('vault.vaultLive') : t('vault.vaultMissing')}</Pill>
              <Pill variant="off">{t('vault.dayCap', { days: termDays })}</Pill>
              <Pill variant="off">pancakeswap v3</Pill>
            </Row>
          </div>
        </Stack>
      </div>

      {prefill?.name ? (
        <Stack surface pad={[14, 18, 14, 18]} className="mt-5">
          <Row justify="between" align="center" gap={12} className="flex-wrap">
            <Row align="center" gap={11} className="min-w-0">
              <AgentAvatar size={38} name={prefill.name} chainId={requestedChain} tokenId={tokenId} />
              <Stack gap={2} className="min-w-0">
                <Txt size={16} lead={22} weight="bold" tone="ink">
                  Hiring {prefill.name}
                </Txt>
                <Txt size={11} lead={16} mono tone="steel">
                  registry {requestedChain} / token #{tokenId} / {agentAddress ? short(agentAddress) : 'no wallet on the record'}
                </Txt>
              </Stack>
            </Row>
            <Pill
              variant={
                pairing === 'match'
                  ? 'keep'
                  : pairing === 'mismatch' || pairing === 'no-executor' || pairing === 'unread'
                    ? 'warn'
                    : 'off'
              }
            >
              {pairingLabel}
            </Pill>
          </Row>
        </Stack>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <Stack surface pad={[20, 22, 20, 22]} gap={14}>
          <SectionHead title={t('vault.open')} note={t('vault.openNote')} />
          {!vault ? (
            <Txt size={13} lead={20} tone="peach">
              No vault is configured for {CHAIN.label}. Switch to a chain with a deployment.
            </Txt>
          ) : null}
          <div className="grid gap-5 md:grid-cols-3">
            <Stack gap={8} className="min-w-0">
              <Label tone="muted">{t('vault.depositToken')}</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['WBNB', 'USDT'] as const).map((s) => (
                  <Btn
                    key={s}
                    kind={tokenChoice === s ? 'keep' : 'off'}
                    onClick={() => setTokenChoice(s)}
                    className="w-full"
                  >
                    {s}
                  </Btn>
                ))}
              </div>
              <Txt size={12} lead={18} tone="steel">
                {tokenChoice === 'USDT'
                  ? 'USDT is the BNB Chain stable. The open only spends what you approve.'
                  : 'WBNB is wrapped from BNB in the signed step below. The open only spends what you approve.'}
              </Txt>
              <Txt size={11} lead={16} mono tone="data">
                {capFor(tokenChoice)}
              </Txt>
            </Stack>
            <Stack gap={8} className="min-w-0">
              <Label tone="muted">{t('vault.depositSize')}</Label>
              <div className="relative">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 pr-20 font-mono text-[13px] leading-[20px] text-souk-ink outline-none focus:border-souk-data"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] uppercase tracking-[0.08em] text-souk-steel">
                  {tokenChoice}
                </span>
              </div>
              <Txt size={12} lead={18} tone="steel">
                The approval is scoped to this exact amount, never a blanket number.
              </Txt>
            </Stack>
            <Stack gap={8} className="min-w-0">
              <Label tone="muted">{t('vault.slippage')}</Label>
              <input
                value={slippage}
                onChange={(e) => setSlippage(Number(e.target.value) || 0)}
                inputMode="numeric"
                className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 font-mono text-[13px] leading-[20px] text-souk-ink outline-none focus:border-souk-data"
              />
              <Txt size={12} lead={18} tone="steel">
                1 to {MAX_SLIPPAGE_BPS} bps.
              </Txt>
            </Stack>
          </div>
          <Stack gap={8}>
            <Label tone="muted">{t('vault.term')}</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {EXPIRY_PRESETS.map((p, i) => (
                <Btn
                  key={p.label}
                  kind={expiryIndex === i ? 'keep' : 'off'}
                  onClick={() => setExpiryIndex(i)}
                  className="w-full"
                  style={{ paddingLeft: 4, paddingRight: 4 }}
                >
                  {termLabel(p.days)}
                </Btn>
              ))}
            </div>
            <Txt size={12} lead={18} tone="steel">
              The farthest rung is the {termDays} day cap. A withdraw is allowed before the term ends.
            </Txt>
          </Stack>
          <Stack gap={4} className="min-w-0">
            <Label tone="muted">{t('vault.payout')}</Label>
            <Txt size={12} lead={18} tone="steel">
              One withdraw returns every balance the hire holds, expired or not. There is no schedule
              and no standing approval.
            </Txt>
          </Stack>
          {!prefill?.wallet ? (
            <Stack gap={8}>
              <Label tone="muted">{t('vault.agentWallet')}</Label>
              <input
                value={manualAgent}
                onChange={(e) => setManualAgent(e.target.value)}
                placeholder="0x..."
                className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 font-mono text-[13px] leading-[20px] text-souk-ink outline-none focus:border-souk-data"
              />
              <Txt size={12} lead={18} tone="steel">
                Open this page from an agent card to name its registry wallet automatically.
              </Txt>
            </Stack>
          ) : null}
          <Rule hair />
          <div className="grid gap-3 rounded-[10px] bg-souk-surface2 px-3.5 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stack gap={1}>
              <Label tone="muted">Deposit</Label>
              <Txt size={12} lead={18} mono tone="ink">
                {amount || '0'} {tokenChoice}
              </Txt>
            </Stack>
            <Stack gap={1}>
              <Label tone="muted">Term</Label>
              <Txt size={12} lead={18} mono tone="ink">
                {termLabel(EXPIRY_PRESETS[expiryIndex].days)}
              </Txt>
            </Stack>
            <Stack gap={1}>
              <Label tone="muted">Slippage</Label>
              <Txt size={12} lead={18} mono tone="ink">
                {slippage} bps
              </Txt>
            </Stack>
            <Stack gap={1}>
              <Label tone="muted">Agent</Label>
              <Txt size={12} lead={18} mono tone={pairing === 'match' ? 'data' : 'slate'}>
                {prefill?.name ?? (agentAddress ? short(agentAddress) : 'not named')}
              </Txt>
            </Stack>
          </div>
          {formError ? (
            <Txt size={12} lead={18} tone="peach">
              {formError}
            </Txt>
          ) : null}
          <Row gap={12} align="center" className="flex-wrap">
            <Btn
              kind="primary"
              onClick={openHire}
              disabled={busy !== null || !vault || !account || !agentAddress}
              className="w-full sm:w-[260px]"
            >
              {busy === 'open' ? t('vault.opening') : t('vault.approveOpen')}
            </Btn>
            <Txt size={12} lead={18} tone="labels">
              {!account
                ? 'Connect a wallet to sign.'
                : !agentAddress
                  ? 'Name the agent wallet first.'
                  : 'Wrap, approve, open: three named signatures at most.'}
            </Txt>
          </Row>
          <Txt size={12} lead={18} tone="steel">
            The open names the agent, the deposit, the expiry, the slippage ceiling and the fee tier
            in one call. The approval is scoped to the exact deposit.
          </Txt>
        </Stack>
        <Stack surface pad={[20, 22, 20, 22]} gap={12}>
          <Row justify="between" align="center" gap={8} className="border-b border-souk-hair pb-2">
            <Txt size={18} lead={27} weight="bold" tone="ink">
              {t('vault.yourHires')}
            </Txt>
            <button
              type="button"
              onClick={refresh}
              disabled={!account}
              className="shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Txt size={10} lead={14} weight="bold" upper tone="data">
                {t('vault.refresh')}
              </Txt>
            </button>
          </Row>
          {!account ? (
            <Stack pad={[14, 16, 14, 16]} gap={8} radius={14} hair className="items-center">
              <SoukMark size={30} />
              <Txt size={13} lead={19} weight="semibold" tone="ink">
                {t('vault.connectRead')}
              </Txt>
            </Stack>
          ) : hiresError ? (
            <Txt size={12} lead={18} tone="peach">
              The hires could not be read: {hiresError}
            </Txt>
          ) : hires === null ? (
            <Txt size={12} lead={18} tone="muted">
              {t('vault.reading')}
            </Txt>
          ) : hires.length > 0 ? (
            <>
              <Stack gap={12}>
                {hires.map((h, i) => {
                  const id = hireIds?.[i] ?? BigInt(i + 1)
                  return (
                    <Stack
                      key={i}
                      gap={7}
                      className="border-t border-souk-hair pt-3 first:border-t-0 first:pt-0"
                    >
                      <Row justify="between" align="center" gap={8}>
                        <Row align="center" gap={8} className="min-w-0">
                          <Dot tone={h.open ? 'good' : 'quiet'} />
                          <Txt size={13} lead={18} weight="semibold" tone="ink">
                            Hire #{id.toString()}
                          </Txt>
                        </Row>
                        <Pill variant={h.open ? 'keep' : 'off'}>{h.open ? 'open' : 'closed'}</Pill>
                      </Row>
                      <div className="grid grid-cols-2 gap-2">
                        <Stack gap={1}>
                          <Label tone="muted">WBNB</Label>
                          <Txt size={12} lead={18} mono tone="slate">
                            {h.balanceA}
                          </Txt>
                        </Stack>
                        <Stack gap={1}>
                          <Label tone="muted">USDT</Label>
                          <Txt size={12} lead={18} mono tone="slate">
                            {h.balanceB}
                          </Txt>
                        </Stack>
                        <Stack gap={1}>
                          <Label tone="muted">Agent</Label>
                          <Txt size={11} lead={16} mono tone="slate">
                            {short(h.agent)}
                          </Txt>
                        </Stack>
                        <Stack gap={1}>
                          <Label tone="muted">Fee / slippage</Label>
                          <Txt size={11} lead={16} mono tone="slate">
                            {h.fee} / {h.maxSlippageBps} bps
                          </Txt>
                        </Stack>
                      </div>
                      {h.open ? (
                        <Btn
                          kind="warn"
                          onClick={() => withdrawHire(id)}
                          disabled={busy !== null}
                          className="w-full"
                        >
                          {busy === `withdraw ${id}` ? t('vault.closing') : t('vault.revoke')}
                        </Btn>
                      ) : null}
                    </Stack>
                  )
                })}
              </Stack>
              {hires.some((h) => !h.open) && vaultRated === undefined ? (
                <RateAgent
                  chainId={requestedChain}
                  tokenId={tokenId}
                  agentName={prefill?.name ?? 'agent'}
                  paymentId={`vault:${requestedChain}:${tokenId}`}
                  onRated={setVaultRated}
                />
              ) : null}
              {vaultRated !== undefined ? (
                <Txt size={12} lead={18} tone="muted">
                  {vaultRated ? `Rated ${vaultRated} of 5.` : 'Rated.'}
                </Txt>
              ) : null}
            </>
          ) : (
            <Stack pad={[14, 16, 14, 16]} gap={8} radius={14} hair className="items-center">
              <SoukMark size={30} />
              <Txt size={13} lead={19} weight="semibold" tone="ink">
                {t('vault.noHires')}
              </Txt>
            </Stack>
          )}
          <Txt size={12} lead={18} tone="muted">
            A revoke is unconditional: every balance comes back in one transaction and is not gated
            on the timeout.
          </Txt>
        </Stack>
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          {vault ? (
            <Stack surface pad={[20, 22, 20, 22]} gap={14}>
              <Row justify="between" align="center" gap={12} className="flex-wrap">
                <Stack gap={3} className="min-w-0">
                  <Txt size={18} lead={27} weight="bold" tone="ink">
                    {t('vault.rules')}
                  </Txt>
                  <Txt size={13} lead={20} tone="muted">
                    The only positions a hire may hold, and the ceiling on each one
                  </Txt>
                </Stack>
                <Row gap={8} align="center" className="shrink-0">
                  <Pill>pancakeswap v3</Pill>
                  <Pill variant="warn">
                    {CHAIN.label} {CHAIN.id}
                  </Pill>
                </Row>
              </Row>
              <div className="grid gap-3 sm:grid-cols-2">
                {[vaultTokenA(requestedChain), vaultTokenB(requestedChain)].map((t) =>
                  t ? (
                    <Stack key={t.symbol} bg="surface2" radius={10} pad={[14, 16, 14, 16]} gap={5}>
                      <Row justify="between" align="center" gap={10}>
                        <Txt size={16} lead={22} weight="bold" tone="ink">
                          {t.symbol}
                        </Txt>
                        <Pill variant="off">{t.decimals} decimals</Pill>
                      </Row>
                      <Txt size={11} lead={16} mono tone="steel" className="break-all">
                        {t.address}
                      </Txt>
                      <Txt size={12} lead={18} mono tone="data">
                        {capFor(t.symbol)}
                      </Txt>
                    </Stack>
                  ) : null,
                )}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {[
                  { value: '500', label: 'Fee tier', note: 'bound when the hire opens' },
                  { value: `${MAX_SLIPPAGE_BPS} bps`, label: 'Slippage ceiling', note: 'the widest the vault takes' },
                  { value: `${termDays} days`, label: 'Term', note: 'the longest the vault holds a hire open' },
                ].map((f) => (
                  <Stack key={f.label} bg="surface2" radius={8} pad={[10, 12, 10, 12]} gap={3}>
                    <Txt size={15} lead={21} weight="bold" mono tone="ink">
                      {f.value}
                    </Txt>
                    <Label tone="muted">{f.label}</Label>
                    <Txt size={11} lead={15} tone="steel">
                      {f.note}
                    </Txt>
                  </Stack>
                ))}
              </div>
              <Txt size={12} lead={18} tone="steel">
                The agent may swap part of the deposit between these two tokens and nothing else, and
                the agent can never move the deposit out. The factory and the fee tier are fixed before
                the hire opens, and the floor is the price read at open rather than the moment of the
                trade.
              </Txt>
            </Stack>
          ) : null}
          <Stack surface pad={[20, 22, 20, 22]} gap={12}>
            <SectionHead title={t('vault.honest')} note={t('vault.honestNote')} />
            <Txt size={12} lead={18} tone="steel">
              {vault
                ? 'The vault holds the deposit. The agent can trade it inside the bound pair and can never move it out. A hire is trading capital, not escrow.'
                : `No vault is configured for ${CHAIN.label}. Nothing on this page can open a hire until one is.`}
            </Txt>
            <Stack gap={7}>
              <Row justify="between" align="start" gap={10}>
                <Txt size={12} lead={18} tone="muted">
                  {t('vault.vaultLabel')}
                </Txt>
                <Txt size={11} lead={18} mono tone="slate" className="text-right">
                  {vault ? short(vault) : t('vault.notConfigured')}
                </Txt>
              </Row>
              <Row justify="between" align="start" gap={10}>
                <Txt size={12} lead={18} tone="muted">
                  {t('vault.chainLabel')}
                </Txt>
                <Txt size={11} lead={18} mono tone="slate" className="text-right">
                  {CHAIN.label} {CHAIN.id}
                </Txt>
              </Row>
              <Row justify="between" align="start" gap={10}>
                <Txt size={12} lead={18} tone="muted">
                  {t('vault.executorLabel')}
                </Txt>
                <Txt size={11} lead={18} mono tone={executor === null || executorUnread ? 'peach' : 'slate'} className="text-right">
                  {executor === undefined
                    ? 'reading...'
                    : executorUnread
                      ? 'unread'
                      : executor
                        ? `${short(executor.address)} (${executor.kind})`
                        : 'not configured'}
                </Txt>
              </Row>
              <Row justify="between" align="start" gap={10}>
                <Txt size={12} lead={18} tone="muted">
                  {t('vault.agentLabel')}
                </Txt>
                <Txt
                  size={11}
                  lead={18}
                  mono
                  tone={pairing === 'mismatch' || pairing === 'no-executor' || pairing === 'unread' ? 'peach' : 'slate'}
                  className="text-right"
                >
                  {pairingLabel}
                </Txt>
              </Row>
            </Stack>
            {vault ? (
              <a
                href={explorerAddressUrl(requestedChain, vault)}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-souk-slate underline decoration-souk-hair underline-offset-2 transition hover:text-souk-ink"
              >
                View the vault on the explorer
              </a>
            ) : null}
            {executorUnread ? (
              <Txt size={12} lead={18} tone="peach">
                The executor could not be read, so the pairing is unknown. The vault can still open a
                hire; check the agent's wallet before funding it.
              </Txt>
            ) : executor === null ? (
              <Txt size={12} lead={18} tone="peach">
                No Agent Souk executor is configured for this deployment. A hire can be opened, but no
                one on our side will trade it.
              </Txt>
            ) : pairing === 'mismatch' ? (
              <Txt size={12} lead={18} tone="peach">
                The named agent is not Agent Souk's executor. It needs its own trader against this
                vault, or the hire will sit untraded.
              </Txt>
            ) : pairing === 'match' ? (
              <Txt size={12} lead={18} tone="data">
                The named agent is Agent Souk's executor.
              </Txt>
            ) : pairing === 'none' ? (
              <Txt size={12} lead={18} tone="muted">
                Name an agent wallet to check it against the executor.
              </Txt>
            ) : null}
          </Stack>
        </div>
      </div>

      {lines.length > 0 ? (
        <div className="mt-5">
          <ResultBox label="What happened" preview={lines.join('\n')} className="whitespace-pre-wrap" />
        </div>
      ) : null}

      <Stack gap={2} className="mt-5">
        <Rule />
        <Txt size={12} lead={18} tone="muted">
          Caps, pair, fee tier, term and slippage ceiling are read from the deployment or entered
          here. Nothing on this page is a performance claim.
        </Txt>
      </Stack>
    </div>
  )
}
