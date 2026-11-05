import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createPublicClient, decodeFunctionResult, encodeFunctionData, formatUnits, http, parseUnits } from 'viem'
import {
  approveCalldata,
  checkAmount,
  checkSlippage,
  expiryFor,
  EXPIRY_PRESETS,
  MAX_SLIPPAGE_BPS,
  MAX_TERM_SECONDS,
  openCalldata,
  tagHirePolicy,
  vaultFor,
  vaultTokenA,
  vaultTokenB,
  withdrawCalldata,
  closeIfGoalCalldata,
  wrapCalldata,
  FEE_TIERS,
  feeLabel,
  pickFeeTier,
  readFeeTiers,
  type FeeChoice,
  type VaultHire,
} from '../lib/vault'
import { chainIdToHex, ensureBscChain, getProvider, setTargetChain } from '../lib/wallet'
import { categoryRail, policyMatchesCategory } from '../lib/vault-category'
import { useConnectedAccount } from '../lib/use-connected-account'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from '../lib/register'
import { explorerAddressUrl } from '../lib/contracts'
import { ratedHires } from '../lib/rating'
import { getVaultExecutor } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { RateAgent } from '../components/RateAgent'
import { CategoryCard } from '../components/CategoryCard'
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
  category: string | null
  minDepositUsd: number | null
}

interface VenueInfo {
  id: string
  name: string
  protocol: string
  kind: string
  status: string
  rateBps: number | null
  rateAsOf: string | null
  note: string
  addresses: string[]
}

interface AgentBadge {
  tokenId: string
  wallet: string
  category: string | null
  policy: string | null
  vaultOnly: boolean
  name: string | null
  firstParty?: boolean
}

// the registry category is the strategy the listing declared, so the hire view
// can say what the agent does instead of showing one generic form for all of them
const STRATEGY_LABEL: Record<string, string> = {
  yield: 'Yield',
  'grid-trading': 'Grid',
  rebalancing: 'Rebalance',
}

function strategyLabel(category: string | null): string | null {
  if (!category) return null
  return STRATEGY_LABEL[category] ?? category.replace(/-/g, ' ')
}

function venueLine(v: VenueInfo): string {
  const rate = v.rateBps == null ? 'rate not published' : `${(v.rateBps / 100).toFixed(2)}% APY`
  return `${v.name} · ${rate}${v.status === 'mock' ? ' · mock' : ''}`
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
    return {
      name: agent?.name ?? null,
      wallet: agent?.agent_wallet ?? agent?.owner_address ?? null,
      category: agent?.category ?? null,
      minDepositUsd: typeof agent?.vaultMinDepositUsd === 'number' ? agent.vaultMinDepositUsd : null,
    }
  } catch {
    return { name: null, wallet: null, category: null, minDepositUsd: null }
  }
}

async function loadVenues(chainId: number): Promise<VenueInfo[]> {
  try {
    const res = await fetch(`${API_BASE}/vault/venues?chain=${chainId}`)
    const body = (await res.json()) as { venues?: VenueInfo[] }
    return Array.isArray(body?.venues) ? body.venues : []
  } catch {
    return []
  }
}

async function loadAgentBadges(chainId: number): Promise<AgentBadge[]> {
  try {
    const res = await fetch(`${API_BASE}/vault/agents?chain=${chainId}`)
    const body = (await res.json()) as { agents?: AgentBadge[] }
    return Array.isArray(body?.agents) ? body.agents : []
  } catch {
    return []
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

// a vault deployed before the venue field returns fewer words than the current
// struct, so the venue is read from its own word instead of a fixed decode
function addressWord(data: `0x${string}`, index: number): string | null {
  const start = 2 + index * 64
  const word = data.slice(start, start + 64)
  return word.length === 64 ? `0x${word.slice(24)}` : null
}

interface VaultHireProps {
  chainId?: string
  tokenId?: string
  onClose?: () => void
  categoryMode?: boolean
}

export default function VaultHirePage(props: VaultHireProps = {}) {
  const params = useParams()
  const isCategoryMode = Boolean(props.categoryMode)
  const categoryParam = (params.category ?? '').toLowerCase()
  const tokenId = props.tokenId ?? params.tokenId ?? ''
  // the chain the url asked for, so a listing's identity is read from its own chain
  const requestedChain = Number(props.chainId ?? params.chainId) > 0 ? Number(props.chainId ?? params.chainId) : 56
  const CHAIN = CHAINS[requestedChain] ?? CHAINS[56]

  const account = useConnectedAccount()
  const { t } = useI18n()
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const [picked, setPicked] = useState<AgentBadge | null>(null)
  const [agentQuery, setAgentQuery] = useState('')
  const rail = categoryRail(isCategoryMode && !picked ? categoryParam : prefill?.category)
  const [manualAgent, setManualAgent] = useState('')
  const [tokenChoice, setTokenChoice] = useState<'WBNB' | 'USDT'>('WBNB')
  // a category that takes one asset never opens as a swap, so the choice follows
  // the rail instead of the other way round
  useEffect(() => {
    if (rail.deposit === 'single') setTokenChoice('USDT')
  }, [rail.deposit])
  // a single asset hire has no pair to size against, so it starts at the smallest
  // sensible stable amount instead of a fraction of a token
  useEffect(() => {
    setAmount(rail.deposit === 'single' ? '5' : '0.1')
  }, [rail.deposit])
  // a /hire deep link can prefill the amount and the term, so the page lands ready
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const wanted = params.get('amount')
    if (wanted && Number(wanted) > 0) setAmount(wanted)
    const days = Number(params.get('days'))
    if (days > 0) {
      const index = EXPIRY_PRESETS.findIndex((preset) => preset.days === days)
      if (index >= 0) setExpiryIndex(index)
    }
  }, [rail.deposit])
  const [amount, setAmount] = useState('0.1')
  const [expiryIndex, setExpiryIndex] = useState(0)
  const [slippage, setSlippage] = useState(5) // percentage (5% = 500 bps)
  const [agentFeeBps] = useState(0) // 0%: our fee is waived; the standard 5% is shown cancelled out below
  const [maxLossBps, setMaxLossBps] = useState(2000) // 20% default
  const [feeOptions, setFeeOptions] = useState<FeeChoice[]>([])
  const [feeOverride, setFeeOverride] = useState<'auto' | number>('auto')
  const [showFee, setShowFee] = useState(false)
  const [goals, setGoals] = useState<Record<string, string>>({})
  const [caps, setCaps] = useState<{ capA: string; capB: string } | null>(null)
  const [maxOpen, setMaxOpen] = useState<number | null>(null)
  const [minDeposit, setMinDeposit] = useState<number | null>(null)
  const [gasPrice, setGasPrice] = useState<bigint | null>(null)
  const [gasEstimate, setGasEstimate] = useState<{ roundTripGas: number; source: string; openSamples: number; withdrawSamples: number } | null>(null)
  const [tracks, setTracks] = useState<Record<string, { hires: number; openHires: number; trades: number } | null>>({})
  const [hires, setHires] = useState<VaultHire[] | null>(null)
  const [hiresError, setHiresError] = useState<string | null>(null)
  const [venues, setVenues] = useState<VenueInfo[] | null>(null)
  // null means the best rate decides; an address means the buyer picked it
  const [venueChoice, setVenueChoice] = useState<string | null>(null)
  const [vaultAgents, setVaultAgents] = useState<AgentBadge[] | null>(null)
  const [positions, setPositions] = useState<Record<string, { value: number | null; pnl: number | null; realized: number | null; pnlKind: string; deposit: number }>>({})
  const [positionsBlock, setPositionsBlock] = useState<number | null>(null)
  const [positionsUnread, setPositionsUnread] = useState<Record<string, string>>({})
  const [priceNote, setPriceNote] = useState<string | null>(null)
  const [hireIds, setHireIds] = useState<bigint[] | null>(null)
  useEffect(() => {
    if (hires && hires.some((h) => !h.open)) {
      setVaultRated(ratedHires().get(`vault:${requestedChain}:${tokenId}`))
    }
  }, [hires, requestedChain, tokenId])
  const [vaultRated, setVaultRated] = useState<number | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [executor, setExecutor] = useState<{ kind: 'rawkey' | 'altana'; address: string; executors?: string[] } | null | undefined>(undefined)
  const [executorUnread, setExecutorUnread] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const token = tokenChoice === 'WBNB' ? vaultTokenA(requestedChain) : vaultTokenB(requestedChain)
  const vault = vaultFor(requestedChain)
  const agentAddress = prefill?.wallet && prefill.wallet !== '0x0000000000000000000000000000000000000000' ? prefill.wallet : manualAgent.trim()

  // a venue pick belongs to one agent, so changing the agent clears it
  useEffect(() => {
    setVenueChoice(null)
  }, [agentAddress, tokenId])

  const autoFee = pickFeeTier(feeOptions)
  const selectedFee = feeOverride === 'auto'
    ? autoFee
    : feeOptions.find((o) => o.fee === feeOverride && o.twapOk) ?? null

  useEffect(() => {
    const a = vaultTokenA(requestedChain)
    const b = vaultTokenB(requestedChain)
    if (!a || !b) return
    let cancelled = false
    const client = createPublicClient({ transport: http(CHAIN.rpc, { timeout: 10_000 }) })
    const read = async (to: string, data: `0x${string}`) =>
      (await client.call({ to: to as `0x${string}`, data })).data ?? '0x'
    readFeeTiers(read, a.address, b.address)
      .then((options) => {
        if (!cancelled) setFeeOptions(options)
      })
      .catch(() => {
        if (!cancelled) setFeeOptions([])
      })
    // the cost of a round trip is priced with the same chain the hire runs on
    client
      .getGasPrice()
      .then((price) => {
        if (!cancelled) setGasPrice(price)
      })
      .catch(() => {
        if (!cancelled) setGasPrice(null)
      })
    return () => {
      cancelled = true
    }
  }, [requestedChain, CHAIN.rpc])

  // The pairing is a fact the page can check, not a claim it can make: the
  // named agent only moves a hire if it is the wallet the executor trades from.
  const executorAddresses = executor
    ? (executor.executors ?? [executor.address]).map((w) => w.toLowerCase())
    : []
  const pairing: 'none' | 'reading' | 'unread' | 'no-executor' | 'match' | 'mismatch' =
    !agentAddress
      ? 'none'
      : executor === undefined
        ? 'reading'
        : executorUnread
          ? 'unread'
          : executor === null
            ? 'no-executor'
            : executorAddresses.includes(agentAddress.toLowerCase())
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

  // the track record comes from the vault's own events, so a third-party agent's
  // history is as checkable as ours
  useEffect(() => {
    const list = (vaultAgents ?? []).filter((a) => a.tokenId !== tokenId).slice(0, 3)
    if (list.length === 0) return
    let alive = true
    Promise.all(
      list.map((a) =>
        fetch(`${API_BASE}/vault/track?chain=${requestedChain}&agent=${a.wallet}`)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      ),
    ).then((rows) => {
      if (!alive) return
      const next: typeof tracks = {}
      list.forEach((a, i) => {
        const body = rows[i] as { success?: boolean; hires?: number; openHires?: number; trades?: number } | null
        next[a.wallet] = body?.success ? { hires: body.hires ?? 0, openHires: body.openHires ?? 0, trades: body.trades ?? 0 } : null
      })
      setTracks(next)
    })
    return () => {
      alive = false
    }
  }, [requestedChain, vaultAgents, tokenId])

  useEffect(() => {
    let alive = true
    loadVenues(requestedChain).then((list) => {
      if (alive) setVenues(list)
    })
    loadAgentBadges(requestedChain).then((list) => {
      if (alive) setVaultAgents(list)
    })
    return () => {
      alive = false
    }
  }, [requestedChain])

  // the form prices the round trip from the vault's own recent receipts once it
  // has them; the constant in the page is only the fallback
  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/vault/gas?chain=${requestedChain}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { success?: boolean; roundTripGas?: number; source?: string; openSamples?: number; withdrawSamples?: number } | null) => {
        if (!alive || !body?.success || typeof body.roundTripGas !== 'number') return
        setGasEstimate({
          roundTripGas: body.roundTripGas,
          source: body.source ?? 'constant',
          openSamples: body.openSamples ?? 0,
          withdrawSamples: body.withdrawSamples ?? 0,
        })
      })
      .catch(() => {
        // the constant stays
      })
    return () => {
      alive = false
    }
  }, [requestedChain])

  useEffect(() => {
    if (tokenId) loadPrefill(String(requestedChain), tokenId).then(setPrefill)
  }, [requestedChain, tokenId])

  // an agent picked inside a category vault stands in for the url prefill, so the
  // form below reads it exactly as it reads a listing opened from its own page
  useEffect(() => {
    if (!picked) return
    setPrefill({
      name: picked.name,
      wallet: picked.wallet,
      category: picked.category,
      minDepositUsd: null,
    })
    setManualAgent('')
  }, [picked])

  // a pick belongs to the category route that made it
  useEffect(() => {
    if (isCategoryMode || tokenId) return
    setPicked(null)
    setPrefill(null)
  }, [isCategoryMode, tokenId])

  useEffect(() => {
    if (!account || !vault) return
    let alive = true
    ;(async () => {
      const provider = await getProvider()
      try {
        const capA = uintWord(await readBytes(provider, vault, encodeFunctionData({ abi: [{ name: 'capA', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const, functionName: 'capA', args: [] })))
        const capB = uintWord(await readBytes(provider, vault, encodeFunctionData({ abi: [{ name: 'capB', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const, functionName: 'capB', args: [] })))
        // the queue cap is a contract constant, so the form can say why it is
        // closed instead of letting the wallet send a revert
        const maxOpenWord = await readBytes(provider, vault, encodeFunctionData({ abi: [{ name: 'MAX_OPEN_PER_BUYER', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const, functionName: 'MAX_OPEN_PER_BUYER', args: [] })).catch((): `0x${string}` => '0x')
        // the smallest hire the contract will take, in token0. on both live pairs
        // token0 is USDT, so a USDT deposit can be checked before signing.
        const minWord = await readBytes(provider, vault, encodeFunctionData({ abi: [{ name: 'minDepositInToken0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const, functionName: 'minDepositInToken0', args: [] })).catch((): `0x${string}` => '0x')
        if (alive) {
          setCaps({ capA: formatUnits(capA, 18), capB: formatUnits(capB, 18) })
          const parsed = Number(uintWord(maxOpenWord))
          setMaxOpen(parsed > 0 ? parsed : null)
          const min = Number(formatUnits(uintWord(minWord), 18))
          setMinDeposit(min > 0 ? min : null)
        }
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
      if (!idsData || idsData === '0x' || idsData.length <= 2) {
        setHireIds([])
        setHires([])
        return
      }
      const decoded = decodeFunctionResult({ abi: [{ name: 'hiresOf', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256[]' }] }] as const, functionName: 'hiresOf', data: idsData }) as bigint[]
      setHireIds(decoded)
      const found: VaultHire[] = []
      for (const id of decoded) {
        const hireData = await readBytes(provider, vault, encodeFunctionData({ abi: [{ name: 'hire', type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] }] as const, functionName: 'hire', args: [id] }))
        // a closed or unknown hire returns no data; skip it instead of crashing the whole read
        if (!hireData || hireData === '0x' || hireData.length <= 2) continue
        let hire: readonly unknown[]
        try {
          hire = decodeFunctionResult({ abi: [{ name: 'hire', type: 'function', stateMutability: 'view', inputs: [], outputs: [
            { type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'uint16' }, { type: 'bool' },
            { type: 'uint256' }, { type: 'uint256' }, { type: 'uint160' }, { type: 'uint24' }, { type: 'uint256' },
            { type: 'uint256' }, { type: 'uint16' }, { type: 'uint256' }, { type: 'uint16' },
          ] }] as const, functionName: 'hire', data: hireData }) as readonly unknown[]
        } catch {
          continue
        }
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
          depositInToken0: String(hire[9]),
          deployedB: formatUnits(hire[10] as bigint, 18),
          agentFeeBps: Number(hire[11]),
          highWaterMark: String(hire[12]),
          maxLossBps: Number(hire[13]),
          venue: addressWord(hireData, 14) ?? '0x0000000000000000000000000000000000000000',
        })
      }
      setHires(found)
      try {
        const res = await fetch(`${API_BASE}/vault/positions?buyer=${account}&chainId=${requestedChain}`)
        const body = await res.json()
        if (body?.success) {
          const map: typeof positions = {}
          for (const p of body.positions ?? []) map[String(p.id)] = p
          setPositions(map)
          setPositionsBlock(body.blockNumber ?? null)
          setPositionsUnread(body.unread ?? {})
          setPriceNote(body.priceSource === 'twap' && body.priceWindowSec ? `twap ${body.priceWindowSec / 60}m` : null)
        }
      } catch {
        setPositions({})
      }
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

  // live P&L: an open hire's value moves with the pool, so the panel re-reads on
  // a fixed cadence while the buyer is looking, without waiting for an action.
  useEffect(() => {
    if (!account || !vault) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      refresh()
    }, 60_000)
    return () => window.clearInterval(id)
  }, [account, vault])

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
    if (!rail.supported) return setFormError(rail.note)
    if (!policyMatchesCategory(agentPolicy, prefill?.category ?? null)) {
      return setFormError(
        `This agent runs the ${agentPolicy} policy, which does not fit a ${rail.category} listing.`,
      )
    }
    setFormError(null)
    if (!vault) return setFormError(`No vault is configured for ${CHAIN.label}.`)
    if (!account) return setFormError('Connect a wallet before opening a hire.')
    if (atQueueCap) return setFormError(`This wallet already holds ${openCount} live hires, the most the vault accepts. Close one to open another.`)
    if (!token) return setFormError('This vault has no bound deposit token.')
    if (!selectedFee) return setFormError('No pool for this pair has enough price history to open a hire.')
    const slErr = checkSlippage(slippage * 100)
    const cap = tokenChoice === 'WBNB' ? caps?.capA ?? null : caps?.capB ?? null
    const amErr = checkAmount(amount, cap)
    if (slErr || amErr) return setFormError(slErr ?? amErr ?? 'Check the form.')
    // USDT is token0 on both live pairs, so the contract's floor is a direct
    // comparison for this choice. a WBNB deposit is valued at the open price and
    // the contract refuses it if it lands under the same floor.
    if (tokenChoice === 'USDT' && requiredMin != null) {
      const asked = Number(amount)
      if (Number.isFinite(asked) && asked < requiredMin) {
        return setFormError(`This hire takes at least ${requiredMin} USDT.`)
      }
    }
    if (!agentAddress) return setFormError('Name the agent wallet, or open this page from the agent card.')
    if (agentPolicy === 'buffer' && !venueTarget) {
      return setFormError('No venue is configured for this chain, so a yield hire cannot open.')
    }
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
      const opened = await sendAndConfirm(provider, account, { to: vault, data: openCalldata(agentAddress, token.address, amount, token.decimals, expiry, slippage * 100, selectedFee.fee, agentFeeBps, maxLossBps, venueTarget ?? ZERO_ADDRESS) }, 'open')
      logLine(`Opened. ${CHAIN.explorer}${opened}`)
      const tag = await tagHirePolicy(opened)
      logLine(tag ? `Tagged hire ${tag.hireId} as ${tag.policy}.` : 'Opened, but the policy tag did not land. The hire waits until it is tagged.')
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

  async function closeIfGoalHire(id: bigint) {
    if (!account || !vault) return
    const raw = goals[id.toString()]?.trim() ?? ''
    const goal = Number(raw)
    if (!Number.isFinite(goal) || goal <= 0) {
      logLine('Enter a goal value greater than zero.')
      return
    }
    try {
      setBusy(`closegoal ${id}`)
      await ensureChain()
      const provider = await getProvider()
      const goalWei = parseUnits(raw, 18)
      const hash = await sendAndConfirm(provider, account, { to: vault, data: closeIfGoalCalldata(id, goalWei) }, 'closeIfGoal')
      logLine(`Hire ${id} closed at goal: ${CHAIN.explorer}${hash}`)
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

  const strategy = strategyLabel(prefill?.category ?? null)

  // the hire records the contract the vault supplied to, so the match is on the
  // adapter address the venue registry publishes, never on a name in the page
  const venueFor = (address: string): VenueInfo | null => {
    if (!address || address === '0x0000000000000000000000000000000000000000') return null
    const a = address.toLowerCase()
    return venues?.find((v) => v.addresses.some((x) => x.toLowerCase() === a)) ?? null
  }

  const badgeFor = (address: string): AgentBadge | null => {
    const a = address.toLowerCase()
    return vaultAgents?.find((x) => x.wallet === a) ?? null
  }

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  // the buyer names the venue at open. a buffer hire must name one; a trading
  // hire names zero and can never supply anywhere.
  const agentPolicy = badgeFor(agentAddress)?.policy ?? null
  const usableVenues = (venues ?? []).filter((v) => v.addresses.length > 0)
  const bestVenue =
    [...usableVenues].sort((a, b) => (b.rateBps ?? 0) - (a.rateBps ?? 0))[0] ?? null
  const chosenVenue = venueChoice
    ? usableVenues.find((v) =>
        v.addresses.some((a) => a.toLowerCase() === venueChoice.toLowerCase()),
      ) ?? null
    : null
  const activeVenue = chosenVenue ?? bestVenue
  const venueTarget = agentPolicy === 'buffer' ? activeVenue?.addresses[0] ?? null : null
  const venueMissing = agentPolicy === 'buffer' && venues !== null && !venueTarget

  const openCount = (hires ?? []).filter((h) => h.open).length
  const atQueueCap = maxOpen !== null && openCount >= maxOpen

  // the agent may ask for more than the vault's floor; the buyer sees the larger
  // of the two before signing
  const requiredMin = Math.max(minDeposit ?? 0, prefill?.minDepositUsd ?? 0) || null
  const chooser = !tokenId && !isCategoryMode
  const categoryAgents = (vaultAgents ?? []).filter((a) => policyMatchesCategory(a.policy, categoryParam))
  const agentNeedle = agentQuery.trim().toLowerCase()
  const shownAgents = categoryAgents.filter(
    (a) =>
      !agentNeedle ||
      (a.name ?? '').toLowerCase().includes(agentNeedle) ||
      a.tokenId.includes(agentNeedle),
  )
  const showForm = !chooser && (!isCategoryMode || picked !== null) && rail.supported
  const railCards: { key: string; label: string; note: string; tally: number | null; available: boolean; to: string }[] = [
    "yield",
    "grid-trading",
    "rebalancing",
    "health-factor",
  ].map((key) => {
    const card = categoryRail(key)
    const tally = (vaultAgents ?? []).filter((a) => policyMatchesCategory(a.policy, key)).length
    return {
      key,
      label: card.label,
      note: card.note,
      tally: vaultAgents ? tally : null,
      available: card.supported,
      to: card.supported ? `/vault/c/${key}` : `/agents?category=${key}`,
    }
  })
  // an agent may ask for more than the vault minimum, so the field starts at the
  // larger of the two rather than opening with a number the form will reject
  useEffect(() => {
    if (requiredMin != null && Number(amount) < requiredMin) setAmount(String(requiredMin))
  }, [requiredMin])
  const depositUsd = (() => {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return null
    if (tokenChoice === 'USDT') return n
    return selectedFee?.price != null ? n * selectedFee.price : null
  })()
  const costDays = EXPIRY_PRESETS[expiryIndex].days ?? 30
  const venueRateBps = venues
    ?.map((v) => v.rateBps)
    .filter((r): r is number => typeof r === 'number' && r > 0)
    .sort((a, b) => b - a)[0] ?? null
  // open plus withdraw. the route averages the vault's recent receipts; this
  // constant is what the deployed vault showed when there were none
  const roundTripGas = gasEstimate?.roundTripGas ?? 250_000
  const gasUsd = gasPrice != null && selectedFee?.price != null
    ? (Number(gasPrice) * roundTripGas / 1e18) * selectedFee.price
    : null
  const yieldUsd = depositUsd != null && venueRateBps != null
    ? depositUsd * (venueRateBps / 10_000) * (costDays / 365)
    : null
  const gasShare = gasUsd != null && yieldUsd != null && yieldUsd > 0 ? gasUsd / yieldUsd : null
  const gasNote = depositUsd != null && (depositUsd < 25 || (gasShare != null && gasShare > 0.2))
  const usd = (n: number) => (n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(6)}`)

  return (
    <div className={props.onClose ? 'bg-souk-canvas px-4 py-6 text-souk-ink' : 'mx-auto min-h-screen bg-souk-canvas px-4 pb-28 text-souk-ink lg:px-8 lg:pb-14'}>
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
              {vault ? `vault ${short(vault)}` : 'no vault'}
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
                  {chooser ? 'Pick a vault.' : rail.ui.title}
                </Txt>
              </h1>
              <Txt size={14} lead={22} tone="slate" className="mt-3 block max-w-[720px]">
                {chooser
                  ? 'Four rails, one custody contract. Open a vault to pick its agent and name the deposit.'
                  : 'The deposit stays in the vault. One withdraw returns it.'}
              </Txt>
            </div>
            <Row gap={8} align="center" className="shrink-0 flex-wrap">
              {showForm ? <Pill variant={vault ? 'keep' : 'warn'}>{vault ? t('vault.vaultLive') : t('vault.vaultMissing')}</Pill> : null}
              {showForm ? <Pill variant="off">{t('vault.dayCap', { days: termDays })}</Pill> : null}
              {showForm ? <Pill variant="off">{rail.label}</Pill> : null}
              {showForm && rail.deposit === 'pair' ? <Pill variant="off">pancakeswap v3</Pill> : null}
            </Row>
          </div>
        </Stack>
      </div>

      {chooser ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {railCards.map((v) => (
            <CategoryCard
              key={v.key}
              category={v.key}
              title={v.label}
              note={v.note}
              measure={
                v.available
                  ? v.tally == null
                    ? 'vault'
                    : `${v.tally} agent${v.tally === 1 ? '' : 's'}`
                  : 'shelf only'
              }
              cta={v.available ? 'Open vault' : 'Browse shelf'}
              to={v.to}
            />
          ))}
        </div>
      ) : null}

      {isCategoryMode && !picked ? (
        <Stack surface pad={[20, 22, 20, 22]} gap={12} className="mt-5">
          <SectionHead title={`${rail.label} vault`} note={rail.note} />
          <Row gap={10} align="center" className="flex-wrap">
            <input
              value={agentQuery}
              onChange={(e) => setAgentQuery(e.target.value)}
              placeholder="Search vault agents"
              className="h-11 min-w-[220px] flex-1 rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 text-[13px] text-souk-ink outline-none focus:border-souk-sky"
            />
            <Link
              to={`/agents?type=vault&category=${categoryParam}`}
              className="h-11 shrink-0 rounded-[8px] border border-souk-hair px-4 font-mono text-[11px] uppercase leading-[44px] tracking-[0.08em] text-souk-data"
            >
              See agents
            </Link>
          </Row>
          <div className="grid gap-2">
            {shownAgents.map((a) => (
              <button
                key={a.tokenId}
                type="button"
                onClick={() => setPicked(a)}
                className="flex items-center justify-between rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 py-3 text-left transition hover:border-souk-sky"
              >
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[12px] text-souk-ink">{a.name ?? `#${a.tokenId}`}</span>
                  {a.firstParty !== false ? (
                    <span className="font-mono text-[10px] lowercase tracking-[0.04em] text-souk-muted">
                      (recommended)
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-data">hire</span>
              </button>
            ))}
            {vaultAgents && shownAgents.length === 0 ? (
              <Txt size={12} lead={18} tone="muted">
                No agent declares a vault hire here. The {rail.label.toLowerCase()} listings sell on the shelf instead.
              </Txt>
            ) : null}
          </div>
          <Row gap={8} align="center" className="flex-wrap">
            <input
              value={manualAgent}
              onChange={(e) => setManualAgent(e.target.value)}
              placeholder="or paste an agent wallet"
              className="h-11 min-w-[220px] flex-1 rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 font-mono text-[12px] text-souk-ink outline-none focus:border-souk-sky"
            />
            <Btn
              kind="off"
              disabled={!/^0x[a-fA-F0-9]{40}$/.test(manualAgent.trim())}
              onClick={() =>
                setPicked({
                  tokenId: '',
                  wallet: manualAgent.trim(),
                  category: rail.category,
                  policy: rail.policy,
                  vaultOnly: true,
                  name: null,
                })
              }
            >
              Use wallet
            </Btn>
          </Row>
        </Stack>
      ) : null}

      {isCategoryMode && picked ? (
        <Stack surface pad={[14, 18, 14, 18]} className="mt-5">
          <Row justify="between" align="center" gap={10} className="flex-wrap">
            <Txt size={13} lead={20} weight="semibold" tone="ink">
              {picked.name ?? `${picked.wallet.slice(0, 6)}...${picked.wallet.slice(-4)}`}
            </Txt>
            <Row gap={12} align="center">
              {picked.tokenId ? (
                <Link
                  to={`/agents/${requestedChain}/${picked.tokenId}`}
                  className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-data"
                >
                  Agent page
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-steel"
              >
                Change
              </button>
            </Row>
          </Row>
        </Stack>
      ) : null}

      {prefill?.name && !isCategoryMode && tokenId ? (
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
            <Row gap={6} align="center" className="shrink-0 flex-wrap">
              {strategy ? <Pill variant="off">{strategy}</Pill> : null}
              {rail.deposit === 'pair' ? (
                <Pill
                  variant={
                    pairing === 'match'
                      ? 'good'
                      : pairing === 'mismatch' || pairing === 'no-executor' || pairing === 'unread'
                        ? 'warn'
                        : 'off'
                  }
                >
                  {pairingLabel}
                </Pill>
              ) : null}
            </Row>
          </Row>
        </Stack>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <Stack
          surface
          pad={[20, 22, 20, 22]}
          gap={14}
          className={showForm || (!rail.supported && rail.ui.unsupported) ? '' : 'hidden'}
        >
          <SectionHead title={rail.ui.heading} note={rail.note} />
          {!rail.supported && rail.ui.unsupported ? (
            <Stack pad={[14, 16, 14, 16]} gap={6} radius={14} hair>
              <Txt size={13} lead={20} weight="semibold" tone="ink">
                {rail.ui.unsupported.title}
              </Txt>
              <Txt size={12} lead={18} tone="slate">
                {rail.ui.unsupported.body}
              </Txt>
              <Link
                to={`/agents?category=${rail.category}`}
                className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-data"
              >
                Browse {rail.label.toLowerCase()} agents
              </Link>
            </Stack>
          ) : null}
          <div className={showForm ? '' : 'hidden'}>
          {!vault ? (
            <Txt size={13} lead={20} tone="peach">
              No vault is configured for {CHAIN.label}. Switch to a chain with a deployment.
            </Txt>
          ) : null}
          <div className="grid gap-5 md:grid-cols-3">
            <Stack gap={8} className="min-w-0">
              <Label tone="muted">{rail.ui.depositLabel}</Label>
              <div className="grid grid-cols-2 gap-2">
                {(rail.deposit === 'single' ? (['USDT'] as const) : (['WBNB', 'USDT'] as const)).map((s) => (
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
              {rail.deposit === 'single' ? null : (
                <Txt size={12} lead={18} tone="steel">
                  {tokenChoice === 'USDT' ? 'Stable. Approve exactly this amount.' : 'Wrapped in the first signature. Approve exactly this amount.'}
                </Txt>
              )}
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
                The approval is scoped to this amount.
              </Txt>
              {requiredMin != null ? (
                <Txt size={11} lead={16} mono tone="data">
                  minimum {requiredMin} USDT{tokenChoice === 'WBNB' ? ' of value at the open price' : ''}
                </Txt>
              ) : null}
              {gasNote && agentPolicy === 'buffer' ? (
                <Txt size={10} lead={14} mono tone="peach">
                  {yieldUsd != null && gasUsd != null
                    ? `${usd(yieldUsd)}/day yield, ${usd(gasUsd)} gas`
                    : 'Thin deposit. Gas can eat a month of yield.'}
                </Txt>
              ) : null}
              {agentPolicy === 'buffer' ? (
                <Stack gap={6}>
                  <Row justify="between" align="center" gap={8}>
                    <Label tone="muted">Venue</Label>
                    <Txt size={10} lead={12} mono tone="steel">
                      {chosenVenue ? 'chosen' : 'best rate'}
                    </Txt>
                  </Row>
                  <div className="flex flex-wrap gap-2">
                    <Btn kind={chosenVenue ? 'off' : 'keep'} onClick={() => setVenueChoice(null)}>
                      Best rate
                    </Btn>
                    {usableVenues.map((v) => (
                      <Btn
                        key={v.id}
                        kind={chosenVenue && chosenVenue.id === v.id ? 'keep' : 'off'}
                        onClick={() => setVenueChoice(v.addresses[0])}
                      >
                        {v.name}
                      </Btn>
                    ))}
                  </div>
                  <Txt size={10} lead={14} mono tone={venueMissing ? 'peach' : 'data'}>
                    {activeVenue
                      ? `${venueLine(activeVenue)} · ${short(activeVenue.addresses[0])}`
                      : venues === null
                        ? 'reading venues'
                        : 'no venue configured for this chain'}
                  </Txt>
                </Stack>
              ) : null}
            </Stack>
            {rail.ui.showsSlippage ? (
              <Stack gap={8} className="min-w-0">
                <Label tone="muted">Slippage (%)</Label>
                <div className="relative">
                  <input
                    value={slippage}
                    onChange={(e) => setSlippage(Number(e.target.value) || 0)}
                    inputMode="decimal"
                    className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 pr-8 font-mono text-[13px] leading-[20px] text-souk-ink outline-none focus:border-souk-data"
                  />
                  <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] uppercase tracking-[0.08em] text-souk-steel">
                    %
                  </span>
                </div>
                <Txt size={12} lead={18} tone="steel">
                  0.01 to 10%.
                </Txt>
              </Stack>
            ) : (
              <Stack gap={8} className="min-w-0">
                <Label tone="muted">Exit</Label>
                <div className="flex h-11 items-center rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 font-mono text-[13px] text-souk-ink">
                  withdraw any time
                </div>
                <Txt size={12} lead={18} tone="steel">
                  0.01 to 10%.
                </Txt>
              </Stack>
            )}
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <Stack gap={8} className="min-w-0">
              <Label tone="muted">Agent fee (% of profit)</Label>
              <div className="relative">
                <input
                  value={3}
                  readOnly
                  className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 pr-8 font-mono text-[13px] leading-[20px] text-souk-steel outline-none line-through opacity-60"
                />
                <span className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 font-mono text-[11px] text-souk-data">0%</span>
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] uppercase tracking-[0.08em] text-souk-steel">
                  %
                </span>
              </div>
              <Txt size={12} lead={18} tone="steel">
                Profit share above the high-water mark.
              </Txt>
            </Stack>
            <Stack gap={8} className="min-w-0">
              <Label tone="muted">Max loss (%)</Label>
              <div className="relative">
                <input
                  value={maxLossBps / 100}
                  onChange={(e) => setMaxLossBps(Math.round((Number(e.target.value) || 0) * 100))}
                  inputMode="decimal"
                  className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 pr-8 font-mono text-[13px] leading-[20px] text-souk-ink outline-none focus:border-souk-data"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] uppercase tracking-[0.08em] text-souk-steel">
                  %
                </span>
              </div>
              <Txt size={12} lead={18} tone="steel">
                Auto-close below this share of the deposit.
              </Txt>
            </Stack>
          </div>
          {rail.ui.showsPoolChoice ? (
          <Stack gap={8} className="min-w-0">
            <Row justify="between" align="center">
              <Label tone="muted">Pool fee</Label>
              <button
                type="button"
                onClick={() => setShowFee((v) => !v)}
                className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-data"
              >
                {showFee ? 'Hide' : 'Change'}
              </button>
            </Row>
            <div className="flex h-11 items-center justify-between rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5">
              <span className="font-mono text-[13px] text-souk-ink">
                {selectedFee
                  ? `${feeLabel(selectedFee.fee)} · ${selectedFee.pool.slice(0, 6)}…${selectedFee.pool.slice(-4)}`
                  : 'no usable pool'}
              </span>
              <Pill variant={selectedFee ? 'keep' : 'off'}>{feeOverride === 'auto' ? 'auto' : 'manual'}</Pill>
            </div>
            <Txt size={12} lead={18} tone="steel">
              Locked at open.
            </Txt>
            {showFee && (
              <select
                value={String(feeOverride)}
                onChange={(e) => setFeeOverride(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3 font-mono text-[13px] text-souk-ink outline-none focus:border-souk-data"
              >
                <option value="auto">Auto · deepest working pool</option>
                {FEE_TIERS.map((fee) => {
                  const option = feeOptions.find((o) => o.fee === fee)
                  return (
                    <option key={fee} value={fee} disabled={!option?.twapOk}>
                      {feeLabel(fee)}
                      {option ? (option.twapOk ? ' · ready' : ' · no history') : ' · no pool'}
                    </option>
                  )
                })}
              </select>
            )}
          </Stack>
          ) : (
          <Stack gap={8} className="min-w-0">
            <Label tone="muted">Valuation</Label>
            <div className="flex h-11 items-center justify-between rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5">
              <span className="font-mono text-[13px] text-souk-ink">
                {vaultTokenA(requestedChain)?.symbol ?? 'WBNB'} / {vaultTokenB(requestedChain)?.symbol ?? 'USDT'}
              </span>
              <Pill variant={selectedFee ? 'keep' : 'off'}>once</Pill>
            </div>
            <Txt size={12} lead={18} tone="steel">
              {rail.ui.poolNote}
            </Txt>
          </Stack>
          )}
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
            <Txt size={12} lead={18} tone="steel">Withdraw any time.</Txt>
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
            {rail.ui.showsSlippage ? (
              <Stack gap={1}>
                <Label tone="muted">Slippage</Label>
                <Txt size={12} lead={18} mono tone="ink">
                  {slippage} %
                </Txt>
              </Stack>
            ) : (
              <Stack gap={1}>
                <Label tone="muted">Rail</Label>
                <Txt size={12} lead={18} mono tone="ink">
                  {rail.label}
                </Txt>
              </Stack>
            )}
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
              disabled={busy !== null || !vault || !account || !agentAddress || atQueueCap || !rail.supported}
              className="w-full sm:w-[260px]"
            >
              {busy === 'open' ? t('vault.opening') : rail.supported ? t('vault.approveOpen') : 'Not available on this rail'}
            </Btn>
            <Txt size={12} lead={18} tone={atQueueCap ? 'peach' : 'labels'}>
              {atQueueCap
                ? `This wallet holds ${openCount} of ${maxOpen} live hires. Close one to open another.`
                : !account
                ? 'Connect a wallet to sign.'
                : !agentAddress
                  ? 'Name the agent wallet first.'
                  : 'Wrap, approve, open: three named signatures at most.'}
            </Txt>
          </Row>
          </div>
        </Stack>
        <Stack surface pad={[20, 22, 20, 22]} gap={12} className={showForm ? '' : 'hidden'}>
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
                  const position = positions[id.toString()]
                  const venue = venueFor(h.venue)
                  const venueNamed = h.venue !== '0x0000000000000000000000000000000000000000'
                  const badge = badgeFor(h.agent)
                  const strategyTag = strategyLabel(badge?.category ?? null)
                  return (
                    <Stack
                      key={i}
                      gap={7}
                      className="border-t border-souk-hair pt-3 first:border-t-0 first:pt-0"
                    >
                      <Row justify="between" align="center" gap={8}>
                        <Row align="center" gap={8} className="min-w-0 flex-wrap">
                          <Dot tone={h.open ? 'good' : 'quiet'} />
                          <Txt size={13} lead={18} weight="semibold" tone="ink">
                            Hire #{id.toString()}
                          </Txt>
                          {strategyTag ? <Pill variant="off">{strategyTag}</Pill> : null}
                        </Row>
                        <Pill variant={h.open ? 'keep' : 'off'}>{h.open ? 'open' : 'closed'}</Pill>
                      </Row>
                      {h.open && position && position.pnlKind === 'unrealized' && position.value != null && position.deposit > 0 ? (() => {
                        const pnl = position.pnl ?? 0
                        const pct = (pnl / position.deposit) * 100
                        const losing = pnl < 0
                        const lossShare = losing ? Math.abs(pct) / Math.max(1, h.maxLossBps / 100) : 0
                        const nearLimit = lossShare >= 0.5
                        return (
                          <div
                            className={`rounded-[8px] border p-3 ${losing ? 'border-souk-peach/50 bg-souk-peach/5' : 'border-souk-data/40 bg-souk-data/5'}`}
                            role="status"
                          >
                            <Row justify="between" align="center" gap={8}>
                              <Txt size={13} lead={18} weight="bold" tone={losing ? 'peach' : 'ink'}>
                                {losing ? 'Losing' : 'Earning'} {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                              </Txt>
                              <Txt size={13} lead={18} mono tone={losing ? 'peach' : 'ink'}>
                                {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)} USDT
                              </Txt>
                            </Row>
                            <Txt size={11} lead={16} tone="slate">
                              position value {position.value.toFixed(4)} USDT of {position.deposit.toFixed(4)} deposited.
                              {' '}{priceNote ? `${priceNote}. ` : ''}Reads live from the pool; refreshes every minute.
                            </Txt>
                            {nearLimit ? (
                              <div className="mt-2 rounded-[6px] border border-souk-peach/60 bg-souk-peach/10 p-2">
                                <Txt size={11} lead={16} weight="bold" tone="peach">
                                  {lossShare >= 1
                                    ? 'The drawdown budget is spent. The guard refuses further trades until value recovers; closing now returns what is left.'
                                    : `This hire has used ${(lossShare * 100).toFixed(0)}% of its ${h.maxLossBps / 100}% drawdown budget. Closing now keeps what is left; waiting risks reaching the limit.`}
                                </Txt>
                                <Btn
                                  kind="warn"
                                  onClick={() => withdrawHire(id)}
                                  disabled={busy !== null}
                                  className="mt-2 w-full"
                                >
                                  {busy === `withdraw ${id}` ? t('vault.closing') : 'Cut loss and close now'}
                                </Btn>
                              </div>
                            ) : null}
                          </div>
                        )
                      })() : null}
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
                          {badge ? (
                            <Link to={`/agents/${requestedChain}/${badge.tokenId}`} className="hover:opacity-70">
                              <Txt size={11} lead={16} mono tone="slate">
                                {short(h.agent)}
                              </Txt>
                            </Link>
                          ) : (
                            <Txt size={11} lead={16} mono tone="slate">
                              {short(h.agent)}
                            </Txt>
                          )}
                        </Stack>
                        <Stack gap={1}>
                          <Label tone="muted">Fee / slippage</Label>
                          <Txt size={11} lead={16} mono tone="slate">
                            {feeLabel(h.fee)} / {(h.maxSlippageBps / 100).toFixed(1)}%
                          </Txt>
                        </Stack>
                        {venueNamed ? (
                          <Stack gap={1} className="col-span-2">
                            <Label tone="muted">Venue</Label>
                            <Txt size={12} lead={18} mono tone={venue ? 'ink' : 'peach'}>
                              {venues === null
                                ? 'reading venue'
                                : venue
                                  ? venueLine(venue)
                                  : `unrecognised ${short(h.venue)}`}
                            </Txt>
                            {Number(h.deployedB) > 0 ? (
                              <Txt size={10} lead={14} mono tone="muted">
                                supplied {h.deployedB} USDT
                              </Txt>
                            ) : null}
                          </Stack>
                        ) : null}
                        {position && position.pnlKind !== 'none' && (position.pnlKind === 'realized' ? position.realized : position.pnl) != null && (
                          <Stack gap={1}>
                            <Label tone="muted">{position.pnlKind === 'realized' ? 'Realized P&L' : 'Value / P&L'}</Label>
                            <Txt
                              size={12}
                              lead={18}
                              mono
                              tone={((position.pnlKind === 'realized' ? position.realized : position.pnl) ?? 0) < 0 ? 'peach' : 'ink'}
                            >
                              {position.pnlKind === 'unrealized' && position.value != null ? `${position.value.toFixed(4)} · ` : ''}
                              {((position.pnlKind === 'realized' ? position.realized : position.pnl) ?? 0) >= 0 ? '+' : ''}
                              {((position.pnlKind === 'realized' ? position.realized : position.pnl) ?? 0).toFixed(6)} USDT
                            </Txt>
                            <Txt size={10} lead={14} mono tone="muted">
                              deposit {position.deposit.toFixed(4)}
                              {priceNote ? ` · ${priceNote}` : ''}
                              {positionsBlock != null ? ` · block ${positionsBlock}` : ''}
                            </Txt>
                          </Stack>
                        )}
                      </div>
                      {h.open ? (
                        <div className="grid gap-2">
                          <Btn
                            kind="warn"
                            onClick={() => withdrawHire(id)}
                            disabled={busy !== null}
                            className="w-full"
                          >
                            {busy === `withdraw ${id}` ? t('vault.closing') : t('vault.revoke')}
                          </Btn>
                          <div className="flex gap-2">
                            <input
                              value={goals[id.toString()] ?? ''}
                              onChange={(e) => setGoals((s) => ({ ...s, [id.toString()]: e.target.value }))}
                              placeholder="Goal value (USDT)"
                              inputMode="decimal"
                              className="h-10 flex-1 rounded-[8px] border border-souk-hair bg-souk-surface2 px-3 font-mono text-[12px] text-souk-ink outline-none focus:border-souk-data"
                            />
                            <Btn
                              kind="off"
                              onClick={() => closeIfGoalHire(id)}
                              disabled={busy !== null}
                              className="shrink-0"
                            >
                              {busy === `closegoal ${id}` ? 'Closing...' : 'Close if goal'}
                            </Btn>
                          </div>
                          <Txt size={10} lead={14} tone="muted">
                            Current {position?.value != null ? `${position.value.toFixed(4)} USDT` : 'value not read'}. Only the buyer can close; the balance goes back to the buyer.
                          </Txt>
                        </div>
                      ) : null}
                    </Stack>
                  )
                })}
              </Stack>
              {Object.keys(positionsUnread).some((k) => k.startsWith('price_')) ? (
                <Txt size={11} lead={16} tone="muted">
                  Some hires sit in a pool without 30 minutes of history, so their live P&amp;L is not shown.
                </Txt>
              ) : null}
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
            Withdraw any time, even mid-term.
          </Txt>
        </Stack>
        <div className={!showForm ? 'hidden' : 'grid grid-cols-1 items-start gap-5 lg:grid-cols-2'}>
          {vault ? (
            <Stack surface pad={[20, 22, 20, 22]} gap={14}>
              <Row justify="between" align="center" gap={12} className="flex-wrap">
                <Stack gap={3} className="min-w-0">
                  <Txt size={18} lead={27} weight="bold" tone="ink">
                    {t('vault.rules')}
                  </Txt>
                  <Txt size={13} lead={20} tone="muted">
                    {rail.deposit === 'pair'
                      ? 'The only positions a hire may hold, and the ceiling on each one'
                      : 'What the hire may hold, and the ceiling on it'}
                  </Txt>
                </Stack>
                <Row gap={8} align="center" className="shrink-0">
                  <Pill>{rail.deposit === 'pair' ? 'pancakeswap v3' : 'lending venue'}</Pill>
                  <Pill variant="warn">
                    {CHAIN.label} {CHAIN.id}
                  </Pill>
                </Row>
              </Row>
              <div className="grid gap-3 sm:grid-cols-2">
                {[vaultTokenA(requestedChain), vaultTokenB(requestedChain)]
                  .filter((t) => t && (rail.deposit === 'pair' || t.symbol === 'USDT'))
                  .map((t) =>
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
                {(rail.deposit === 'pair'
                  ? [
                      { value: selectedFee ? feeLabel(selectedFee.fee) : 'none', label: 'Fee tier', note: 'bound when the hire opens' },
                      { value: `${MAX_SLIPPAGE_BPS / 100}%`, label: 'Slippage ceiling', note: 'the widest the vault takes' },
                      { value: `${termDays} days`, label: 'Term', note: 'the longest the vault holds a hire open' },
                    ]
                  : [
                      { value: 'venue', label: 'Lending venue', note: 'named by the buyer at open' },
                      { value: 'exit', label: 'Withdraw', note: 'any time, no slippage' },
                      { value: `${termDays} days`, label: 'Term', note: 'the longest the vault holds a hire open' },
                    ]
                ).map((f) => (
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
                {rail.deposit === 'pair'
                  ? 'The agent may swap part of the deposit between these two tokens and nothing else, and it can never move the deposit out. The factory and the fee tier are fixed before the hire opens.'
                  : 'The agent may supply the deposit to the venue named at open and nothing else, and it can never move the deposit out.'}
              </Txt>
            </Stack>
          ) : null}
          <Stack surface pad={[20, 22, 20, 22]} gap={12}>
            <SectionHead title={t('vault.honest')} note={t('vault.honestNote')} />
            <Txt size={12} lead={18} tone="steel">
              {vault
                ? rail.deposit === 'single'
                  ? 'The vault holds the deposit. The agent can supply it to the named venue and can never move it out. A hire is working capital, not escrow.'
                  : 'The vault holds the deposit. The agent can trade it inside the bound pair and can never move it out. A hire is trading capital, not escrow.'
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
                        ? `${short(pairing === 'match' ? agentAddress : executor.address)} (${executor.kind})`
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
