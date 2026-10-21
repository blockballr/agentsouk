import { useState } from 'react'
import { getProvider, ensureBscChain } from '../lib/wallet'
import { useActiveAccount } from '../lib/use-active-account'
import { SETTLEMENT_ASSET_BY_CHAIN } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import { encodeFunctionData } from 'viem'
import { Btn, Stack, Row, Txt } from './souk'

const HIRE_VAULT_ABI = [
  {
    name: 'open',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
      { name: 'maxSlippageBps', type: 'uint16' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'hire',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'buyer', type: 'address' },
      { name: 'agent', type: 'address' },
      { name: 'expiry', type: 'uint64' },
      { name: 'maxSlippageBps', type: 'uint16' },
      { name: 'open', type: 'bool' },
      { name: 'balanceA', type: 'uint256' },
      { name: 'balanceB', type: 'uint256' },
    ],
  },
] as const

export function VaultPanel({ vaultAddress, agentAddress }: { vaultAddress: string; agentAddress: string }) {
  const account = useActiveAccount()
  const target = useTargetChain()
  const chainId = target?.chainId ?? 97
  const [hireId, setHireId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [balanceA, setBalanceA] = useState<string | null>(null)
  const [balanceB, setBalanceB] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const asset = SETTLEMENT_ASSET_BY_CHAIN[chainId]

  async function openHire() {
    if (!account || !amount) return
    setBusy(true)
    setError(null)
    try {
      await ensureBscChain()
      const provider = await getProvider()
      const decimals = 18
      const units = BigInt(Math.round(parseFloat(amount) * 10 ** decimals))
      const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
      const data = encodeFunctionData({
        abi: HIRE_VAULT_ABI,
        functionName: 'open',
        args: [agentAddress as `0x${string}`, asset.address as `0x${string}`, units, BigInt(expiry), 500, 2500],
      })
      await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: vaultAddress, data }],
      })
      // hireId would come from tx receipt logs; for now use pending
      setHireId('pending')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Open failed')
    } finally {
      setBusy(false)
    }
  }

  async function withdraw() {
    if (!account || !hireId || hireId === 'pending') return
    setBusy(true)
    setError(null)
    try {
      await ensureBscChain()
      const provider = await getProvider()
      const data = encodeFunctionData({
        abi: HIRE_VAULT_ABI,
        functionName: 'withdraw',
        args: [BigInt(hireId)],
      })
      await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: vaultAddress, data }],
      })
      setHireId(null)
      setBalanceA(null)
      setBalanceB(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Withdraw failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap={12} surface pad={[16, 18, 16, 18]}>
      <Txt size={14} lead={20} weight="semibold" tone="ink">
        Set and Earn vault
      </Txt>
      <Txt size={12} lead={18} tone="slate">
        Deposit {asset.symbol} into a bounded vault. The agent trades within slippage and drawdown limits. Withdraw anytime.
      </Txt>

      {error && (
        <Txt size={11} lead={16} tone="peach">{error}</Txt>
      )}

      {!hireId ? (
        <Stack gap={8}>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount in ${asset.symbol}`}
            className="h-[36px] w-full rounded-[8px] border border-souk-hair bg-souk-surface1 px-3 text-[13px] text-souk-ink"
          />
          <Btn kind="primary" disabled={busy || !amount || !account} onClick={() => void openHire()}>
            {busy ? 'Opening…' : `Open hire with ${amount || '0'} ${asset.symbol}`}
          </Btn>
        </Stack>
      ) : (
        <Stack gap={8}>
          <Row justify="between" align="center">
            <Txt size={12} lead={18} tone="slate">Hire ID</Txt>
            <Txt size={12} lead={18} mono tone="ink">{hireId}</Txt>
          </Row>
          {balanceA !== null && (
            <Row justify="between" align="center">
              <Txt size={12} lead={18} tone="slate">Balance A</Txt>
              <Txt size={12} lead={18} mono tone="ink">{balanceA}</Txt>
            </Row>
          )}
          {balanceB !== null && (
            <Row justify="between" align="center">
              <Txt size={12} lead={18} tone="slate">Balance B</Txt>
              <Txt size={12} lead={18} mono tone="ink">{balanceB}</Txt>
            </Row>
          )}
          <Btn kind="warn" disabled={busy} onClick={() => void withdraw()}>
            {busy ? 'Withdrawing…' : 'Withdraw all'}
          </Btn>
        </Stack>
      )}
    </Stack>
  )
}