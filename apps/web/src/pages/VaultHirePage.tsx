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
  openCalldata,
  vaultFor,
  vaultTokenA,
  vaultTokenB,
  withdrawCalldata,
  wrapCalldata,
  type VaultHire,
} from '../lib/vault'
import { chainIdToHex, connectWallet, ensureBscChain, getActiveAccount, getProvider, setTargetChain } from '../lib/wallet'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from '../lib/register'
import { explorerAddressUrl } from '../lib/contracts'
import { Action, LABEL, ResultBox, TextSlot, button, card, cx } from '../components/ui'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

// the vault is a chain-97 contract today; chain 56 waits on the outside review
const CHAIN = { id: 97, label: 'BSC testnet', rpc: 'https://bsc-testnet-rpc.publicnode.com', explorer: 'https://testnet.bscscan.com/tx/' } as const

interface Prefill {
  name: string | null
  wallet: string | null
}

// the named agent comes from the wallet the registry record declares, so the
// hire names the same address the listing already pays
async function loadPrefill(tokenId: string): Promise<Prefill> {
  try {
    const res = await fetch(`${API_BASE}/agents/97/${tokenId}`)
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

  const token = tokenChoice === 'WBNB' ? vaultTokenA(97) : vaultTokenB(97)
  const vault = vaultFor(97)
  const agentAddress = prefill?.wallet && prefill.wallet !== '0x0000000000000000000000000000000000000000' ? prefill.wallet : manualAgent

  useEffect(() => {
    connectWallet().then(getActiveAccount).then(setAccount).catch(() => setAccount(null))
  }, [])

  useEffect(() => {
    if (tokenId) loadPrefill(tokenId).then(setPrefill)
  }, [tokenId])

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
    setTargetChain(97)
    const chain = await ensureBscChain()
    if (chain?.toLowerCase() !== chainIdToHex(97)) {
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
      <div className={cx(card('plain', 'lg'))}>
        <p className={LABEL}>Funded hire</p>
        <h1 className="mt-2 font-serif text-3xl text-press-black">Hire an agent that trades a bounded deposit</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-newsprint-gray">
          The deposit sits in the HireVault contract, not with the marketplace and not with the agent.
          The agent is named per hire and may only trade the bound pair inside a floor fixed at open
          and a drawdown budget that bounds the whole loss. Revoking is one transaction, yours alone.
        </p>
        {prefill?.name ? (
          <p className="mt-3 text-[15px] text-press-black">
            Hiring {prefill.name}, the agent the registry records at {agentAddress ? short(agentAddress) : 'no wallet'}.
          </p>
        ) : null}
      </div>

      <div className={cx(card('plain', 'lg'))}>
        <p className={LABEL}>Open a hire</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className={LABEL}>Deposit token</p>
            <div className="mt-2 flex gap-2">
              {(['WBNB', 'USDT'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setTokenChoice(s)} className={cx(button(tokenChoice === s ? 'primary' : 'secondary', 'sm'))}>
                  {s}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[13px] leading-5 text-newsprint-gray">
              {tokenChoice === 'USDT'
                ? 'USDT is the un-minted testnet stable, bought from the vaults own pool first. The open only spends what you approve.'
                : 'WBNB is wrapped from the chains tBNB in the signed step below. The open only spends what you approve.'}
            </p>
          </div>
          <div>
            <p className={LABEL}>Deposit size ({caps ? capLine : 'connecting'})</p>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className={cx('mt-2 w-full rounded-[5px] border border-slate-verdant/50 bg-white px-3 py-2 font-mono text-sm text-press-black')}
            />
          </div>
          <div>
            <p className={LABEL}>The hire ends</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXPIRY_PRESETS.map((p, i) => (
                <button key={p.label} type="button" onClick={() => setExpiryIndex(i)} className={cx(button(expiryIndex === i ? 'primary' : 'secondary', 'sm'))}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className={LABEL}>Slippage ceiling, 1 to {MAX_SLIPPAGE_BPS} bps</p>
            <input
              value={slippage}
              onChange={(e) => setSlippage(Number(e.target.value) || 0)}
              inputMode="numeric"
              className={cx('mt-2 w-full rounded-[5px] border border-slate-verdant/50 bg-white px-3 py-2 font-mono text-sm text-press-black')}
            />
          </div>
          {!prefill?.wallet ? (
            <div className="sm:col-span-2">
              <p className={LABEL}>Agent wallet to name</p>
              <input
                value={manualAgent}
                onChange={(e) => setManualAgent(e.target.value)}
                placeholder="0x..."
                className={cx('mt-2 w-full rounded-[5px] border border-slate-verdant/50 bg-white px-3 py-2 font-mono text-sm text-press-black')}
              />
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Action variant="primary" size="lg" onClick={openHire} disabled={busy !== null}>
            {busy === 'open' ? 'Opening...' : 'Approve and open'}
          </Action>
          <span className="text-[13px] text-newsprint-gray">three named signatures at most: wrap, approve, open</span>
        </div>
      </div>

      <div className={cx(card('plain', 'lg'))}>
        <div className="flex items-baseline justify-between">
          <p className={LABEL}>Your hires on chain</p>
          <Action variant="quiet" size="sm" onClick={refresh} disabled={!account}>
            Refresh
          </Action>
        </div>
        {hires && hires.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            {hires.map((h, i) => (
              <div key={i} className="rounded-[10px] border border-slate-verdant/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[13px] text-press-black">
                    hire {i}: {h.open ? 'open' : 'closed'} | in {h.balanceA} WBNB, {h.balanceB} USDT | agent {short(h.agent)} | floor fee {h.fee} | slippage {h.maxSlippageBps} bps
                  </p>
                  {h.open ? (
                    <Action variant="secondary" size="sm" onClick={() => withdrawHire(hireIds?.[i] ?? BigInt(i + 1))} disabled={busy !== null}>
                      {busy === `withdraw ${hireIds?.[i] ?? BigInt(i + 1)}` ? 'Closing...' : 'Revoke and withdraw'}
                    </Action>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <TextSlot lines={2} className="mt-4">
            {account ? 'No hires from this wallet on the vault yet.' : 'Connect the wallet to read your hires from the vault.'}
          </TextSlot>
        )}
      </div>

      {lines.length > 0 ? (
        <ResultBox label="What happened" preview={lines.join('\n')} className="whitespace-pre-wrap" />
      ) : null}

      <div className={cx(card('accent', 'md'))}>
        <p className={LABEL}>Honest state</p>
        <p className="mt-2 text-[13px] leading-5 text-press-black">
          The vault is live on {CHAIN.label} at {vault ? `${short(vault)} (${explorerAddressUrl(97, vault)})` : 'not configured'}
          , and its open-trade-withdraw loop is proven from scripts and a live smoke. The agent side that trades
          these hires runs from the executor service; a hire opened by a wallet the team owns does not count
          toward any quest.
        </p>
      </div>
    </div>
  )
}
