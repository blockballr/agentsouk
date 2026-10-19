import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
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
import { connectWallet } from '../lib/wallet-session'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from '../lib/register'
import { explorerAddressUrl } from '../lib/contracts'
import { ResultBox } from '../components/ui'
import {
  Stack,
  Row,
  Txt,
  Pill,
  Dot,
  SectionHead,
  NoteBox,
  Kpi,
  DataTable,
  Btn,
  Rule,
  Label,
  SoukMark,
  AgentAvatar,
  type TableRowSpec,
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

  const [account, setAccount] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const [manualAgent, setManualAgent] = useState('')
  const [tokenChoice, setTokenChoice] = useState<'WBNB' | 'USDT'>('WBNB')
  const [amount, setAmount] = useState('0.01')
  const [expiryIndex, setExpiryIndex] = useState(1)
  const [slippage, setSlippage] = useState(500)
  const [caps, setCaps] = useState<{ capA: string; capB: string } | null>(null)
  const [hires, setHires] = useState<VaultHire[] | null>(null)
  const [hireIds, setHireIds] = useState<bigint[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])

  const token = tokenChoice === 'WBNB' ? vaultTokenA(requestedChain) : vaultTokenB(requestedChain)
  const vault = vaultFor(requestedChain)
  const agentAddress = prefill?.wallet && prefill.wallet !== '0x0000000000000000000000000000000000000000' ? prefill.wallet : manualAgent

  useEffect(() => {
    connectWallet().then(setAccount).catch(() => setAccount(null))
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
      setLines((l) => [...l, `The hires could not be read: ${(e as Error).message}`])
    }
  }

  useEffect(() => {
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
    if (!account || !vault || !token) return setLines((l) => [...l, 'Connect the wallet first.'])
    const slErr = checkSlippage(slippage)
    const cap = tokenChoice === 'WBNB' ? caps?.capA ?? null : caps?.capB ?? null
    const amErr = checkAmount(amount, cap)
    if (slErr || amErr) return setLines((l) => [...l, slErr ?? amErr ?? ''])
    if (!agentAddress) return setLines((l) => [...l, 'Name the agent: open this panel from an agent page, or paste the agent wallet.'])
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

  const capLine = caps ? `caps ${caps.capA} WBNB / ${caps.capB} USDT` : 'caps read from the vault when the wallet connects'

  // the band states only what the deployment itself publishes
  const termDays = MAX_TERM_SECONDS / 86_400
  const kpis = [
    ...(caps
      ? [
          { value: `${caps.capA} WBNB`, label: 'Cap per deposit, token A' },
          { value: `${caps.capB} USDT`, label: 'Cap per deposit, token B' },
        ]
      : []),
    { value: `${termDays} days`, label: 'Longest term the vault takes' },
    { value: `${MAX_SLIPPAGE_BPS} bps`, label: 'Widest slippage the vault takes' },
  ]

  // cap text waits on the read, the pair itself is pinned in lib/vault
  const capFor = (symbol: string) =>
    caps ? `${symbol === 'WBNB' ? caps.capA : caps.capB} per deposit` : 'read when the wallet connects'
  const pairRows: TableRowSpec[] = [vaultTokenA(requestedChain), vaultTokenB(requestedChain)].flatMap((t) =>
    t
      ? [
          {
            cells: [
              { text: t.symbol, weight: 'semibold', tone: 'ink' },
              { text: t.address, size: 12, mono: true, tone: 'slate', className: 'break-all' },
              { text: String(t.decimals), size: 12, mono: true, tone: 'steel' },
              { text: capFor(t.symbol), size: 12, mono: true, tone: 'data' },
            ],
          },
        ]
      : [],
  )

  return (
    <div className="mx-auto min-h-screen bg-souk-canvas px-4 lg:px-8 pb-[240px] text-souk-ink xl:pb-16">
      <Stack gap={10} className="pt-8">
        <Txt size={11} lead={16} mono upper tone="data">
          VAULT HIRE · {CHAIN.label} {CHAIN.id} · VAULT {vault ? short(vault) : 'not configured'}
          {tokenId ? ` · TOKEN #${tokenId}` : ''}
        </Txt>
        <h1 className="m-0">
          <Txt size={34} lead={42} display weight="bold" tone="ink">
            Hire an agent that trades a bounded deposit.
          </Txt>
        </h1>
      </Stack>

      {kpis.length > 0 ? (
        <Row gap={20} className="mt-6 flex-wrap">
          {kpis.map((k) => (
            <Kpi key={k.label} value={k.value} label={k.label} />
          ))}
        </Row>
      ) : null}

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1316fr_520fr]">
        <div className="flex min-w-0 flex-col gap-5">
          {prefill?.name ? (
            <Stack surface pad={[20, 22, 20, 22]} gap={12}>
              <SectionHead
                title="The agent this hire names"
                note={`REGISTRY ${requestedChain} · TOKEN #${tokenId}`}
              />
              <Row align="center" gap={11} className="flex-wrap">
                <AgentAvatar size={34} name={prefill.name} chainId={requestedChain} tokenId={tokenId} />
                <Stack gap={2} className="min-w-0">
                  <Txt size={17} lead={22} weight="bold" tone="ink">
                    {prefill.name}
                  </Txt>
                  <Txt size={11} lead={15} mono tone="labels">
                    {agentAddress ? short(agentAddress) : 'no wallet on the record'}
                  </Txt>
                </Stack>
              </Row>
              <Txt size={13} lead={20} weight="semibold" tone="ink">
                Hiring {prefill.name}, the agent the registry records at{' '}
                {agentAddress ? short(agentAddress) : 'no wallet'}.
              </Txt>
              <Txt size={12} lead={18} tone="steel">
                The registry record above is what the route points at: chain {requestedChain}, token {tokenId}.
              </Txt>
            </Stack>
          ) : null}

          {vault && pairRows.length > 0 ? (
            <Stack surface pad={[20, 22, 20, 22]} gap={12}>
              <Row justify="between" align="center" gap={12} className="flex-wrap">
                <Stack gap={3} className="min-w-0">
                  <Txt size={18} lead={27} weight="bold" tone="ink">
                    The bound pair
                  </Txt>
                  <Txt size={13} lead={20} tone="muted">
                    The only positions a hire may hold, and the ceiling on each one
                  </Txt>
                </Stack>
                <Row gap={8} align="center" className="shrink-0">
                  <Pill>pancakeswap v3</Pill>
                  <Pill variant="warn">{CHAIN.label} {CHAIN.id}</Pill>
                </Row>
              </Row>
              {/* the address column is a fixed 540 in the design; letting the table
                  scroll keeps the page itself from going sideways on a phone */}
              <div className="overflow-x-auto">
                <DataTable
                  cols={[280, 540, 160, 292]}
                  header={['TOKEN', 'ADDRESS', 'DECIMALS', 'CAP PER DEPOSIT']}
                  rows={pairRows}
                />
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
                The agent may swap part of the deposit between these two tokens and nothing else, and the
                agent can never move the deposit out. The factory and the fee tier are fixed before the
                hire opens, so the caller chooses none of them, and the floor a trade is measured against
                is read at open rather than at the moment of the trade.
              </Txt>
            </Stack>
          ) : null}

          <Stack surface pad={[20, 22, 20, 22]} gap={14}>
            <SectionHead title="Open a hire" note="THREE NAMED SIGNATURES AT MOST" />
            <div className="grid gap-5 sm:grid-cols-2">
              <Stack gap={2} className="min-w-0">
                <Label tone="muted">Deposit token</Label>
                <Row gap={10} className="mt-1.5 flex-wrap">
                  {(['WBNB', 'USDT'] as const).map((s) => (
                    <Btn
                      key={s}
                      kind={tokenChoice === s ? 'primary' : 'off'}
                      onClick={() => setTokenChoice(s)}
                      className="w-[150px]"
                    >
                      {s}
                    </Btn>
                  ))}
                </Row>
                <Txt size={12} lead={18} tone="steel">
                  {tokenChoice === 'USDT'
                    ? 'USDT is the BNB Chain stable, bought from the vaults own pool first. The open only spends what you approve.'
                    : 'WBNB is wrapped from the chains BNB in the signed step below. The open only spends what you approve.'}
                </Txt>
              </Stack>
              <Stack gap={8} className="min-w-0">
                <Label tone="muted">Deposit size ({caps ? capLine : 'connecting'})</Label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 font-mono text-[13px] leading-[20px] text-souk-ink outline-none"
                />
              </Stack>
            </div>
            <Stack gap={8}>
              <Label tone="muted">The hire ends · the farthest rung is the {termDays} day cap itself</Label>
              <Row gap={8}>
                {EXPIRY_PRESETS.map((p, i) => (
                  <Btn
                    key={p.label}
                    kind={expiryIndex === i ? 'primary' : 'off'}
                    onClick={() => setExpiryIndex(i)}
                    className="min-w-0 flex-1 basis-0"
                  >
                    {p.label}
                  </Btn>
                ))}
              </Row>
            </Stack>
            <div className="grid gap-5 sm:grid-cols-2">
              <Stack gap={8} className="min-w-0">
                <Label tone="muted">Slippage ceiling, 1 to {MAX_SLIPPAGE_BPS} bps</Label>
                <input
                  value={slippage}
                  onChange={(e) => setSlippage(Number(e.target.value) || 0)}
                  inputMode="numeric"
                  className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 font-mono text-[13px] leading-[20px] text-souk-ink outline-none"
                />
              </Stack>
              <Stack gap={4} className="min-w-0">
                <Label tone="muted">The payout</Label>
                <Txt size={12} lead={18} tone="steel">
                  One withdraw returns every balance the hire holds, expired or not. There is no schedule
                  and no standing approval, and the only signature it needs is the buyer&apos;s.
                </Txt>
              </Stack>
            </div>
            {!prefill?.wallet ? (
              <Stack gap={8}>
                <Label tone="muted">Agent wallet to name</Label>
                <input
                  value={manualAgent}
                  onChange={(e) => setManualAgent(e.target.value)}
                  placeholder="0x..."
                  className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 font-mono text-[13px] leading-[20px] text-souk-ink outline-none"
                />
              </Stack>
            ) : null}
            <Rule hair />
            <Row gap={12} align="center" className="flex-wrap">
              <Btn kind="primary" onClick={openHire} disabled={busy !== null} className="w-[260px]">
                {busy === 'open' ? 'Opening...' : 'Approve and open'}
              </Btn>
              <Txt size={12} lead={18} tone="labels">
                three named signatures at most: wrap, approve, open
              </Txt>
            </Row>
            <Txt size={12} lead={18} tone="steel">
              The approval is scoped to the exact deposit, never a blanket number, and the open names the
              agent, the deposit, the expiry, the slippage ceiling and the fee tier in one call.
            </Txt>
          </Stack>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Stack surface pad={[20, 22, 20, 22]} gap={12}>
            <Row justify="between" align="center">
              <Txt size={15} lead={22} weight="bold" tone="ink">
                Your hires on chain
              </Txt>
              <button
                type="button"
                onClick={refresh}
                disabled={!account}
                className="shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Txt size={10} lead={14} weight="bold" upper tone="data">
                  Refresh
                </Txt>
              </button>
            </Row>
            {hires && hires.length > 0 ? (
              <Stack gap={12}>
                <Rule hair />
                {hires.map((h, i) => {
                  const id = hireIds?.[i] ?? BigInt(i + 1)
                  return (
                    <Row key={i} justify="between" align="center" gap={10}>
                      <Row align="center" gap={9} className="min-w-0">
                        <Dot tone={h.open ? 'good' : 'quiet'} />
                        <Txt size={11} lead={16} mono tone="slate" className="min-w-0" >
                          hire {i}: {h.open ? 'open' : 'closed'} | in {h.balanceA} WBNB, {h.balanceB} USDT | agent {short(h.agent)} | floor fee {h.fee} | slippage {h.maxSlippageBps} bps
                        </Txt>
                      </Row>
                      {h.open ? (
                        <Btn
                          kind="warn"
                          onClick={() => withdrawHire(id)}
                          disabled={busy !== null}
                          className="shrink-0 whitespace-nowrap"
                        >
                          {busy === `withdraw ${id}` ? 'Closing...' : 'Revoke and withdraw'}
                        </Btn>
                      ) : null}
                    </Row>
                  )
                })}
              </Stack>
            ) : (
              <Stack pad={[14, 16, 14, 16]} gap={8} radius={14} hair className="items-center">
                <SoukMark size={30} />
                <Txt size={13} lead={19} weight="semibold" tone="ink">
                  {account
                    ? 'No hires from this wallet on the vault yet.'
                    : 'Connect the wallet to read your hires from the vault.'}
                </Txt>
              </Stack>
            )}
            <Txt size={12} lead={18} tone="muted">
              A revoke is unconditional: every balance comes back in one transaction and is not gated on
              the timeout.
            </Txt>
          </Stack>

          <NoteBox
            title="Honest state"
            copy={`The vault is live on ${CHAIN.label} at ${
              vault ? short(vault) : 'not configured'
            }, and its open-trade-withdraw loop is proven from scripts and a live smoke. The agent side that trades these hires runs from the executor service; a hire opened by a wallet the team owns does not count toward any quest.`}
            rows={[
              { label: 'VAULT', value: vault ? short(vault) : 'not configured', mono: true },
              { label: 'CHAIN', value: `${CHAIN.label} ${CHAIN.id}` },
              {
                label: 'EXPLORER',
                // host plus short address, the drawn value; the full url has no break
                // opportunity and pushed the page sideways on a phone
                value: vault
                  ? `${explorerAddressUrl(requestedChain, vault).replace(/^https?:\/\//, '').split('/address/')[0]}/address/${short(vault)}`
                  : 'not configured',
                mono: true,
                width: 220,
              },
            ]}
          />
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
          Every figure above is read off the deployment: the caps, the bound pair, the term, the fee tier
          and the slippage ceiling.
        </Txt>
      </Stack>
    </div>
  )
}
