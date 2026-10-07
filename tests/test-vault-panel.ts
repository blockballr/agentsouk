import { describe, expect, it } from 'vitest'
import { decodeFunctionData, parseUnits } from 'viem'
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
} from '../apps/web/src/lib/vault'

const AGENT = '0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713'
const VAULT = '0xc742e51f3fe3875a3335700a7d692f40dc8e60b8'

describe('the panel contracts the vault actually enforces', () => {
  it('has a vault only on chain 97', () => {
    expect(vaultFor(97)).toBe(VAULT)
    expect(vaultFor(56)).toBe(null)
  })

  it('binds the same pair the deployment uses', () => {
    expect(vaultTokenA(97)?.address).toBe('0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd')
    expect(vaultTokenB(97)?.address).toBe('0x337610d27c682E347C9cD60BD4b3b107C9d34dDd')
  })

  it('encodes the six-argument open and reads it back whole', () => {
    const expiry = expiryFor(7)
    const data = openCalldata(AGENT, vaultTokenB(97)!.address, '0.1', 18, expiry, 500, 500)
    const decoded = decodeFunctionData({ abi: [
      { name: 'open', type: 'function', stateMutability: 'nonpayable', inputs: [
        { name: 'agent', type: 'address' }, { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' }, { name: 'expiry', type: 'uint64' },
        { name: 'maxSlippageBps', type: 'uint16' }, { name: 'fee', type: 'uint24' },
      ], outputs: [{ type: 'uint256' }] },
    ] as const, data })
    expect(String(decoded.args[0]).toLowerCase()).toBe(AGENT.toLowerCase())
    expect(decoded.args[2]).toBe(parseUnits('0.1', 18))
    expect(decoded.args[3]).toBe(BigInt(expiry))
    expect(decoded.args[4]).toBe(500)
    expect(decoded.args[5]).toBe(500)
  })

  it('keeps every preset expiry inside the vault horizon', () => {
    const now = Math.floor(Date.now() / 1000)
    for (const preset of EXPIRY_PRESETS) {
      const expiry = expiryFor(preset.days)
      expect(expiry).toBeGreaterThan(now)
      expect(expiry - now).toBeLessThanOrEqual(MAX_TERM_SECONDS)
    }
  })

  it('wraps and withdraws with the payable/one-argument shapes', () => {
    expect(wrapCalldata()).toBe('0xd0e30db0') // deposit()
    const decoded = decodeFunctionData({ abi: [
      { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
    ] as const, data: withdrawCalldata(7n) })
    expect(decoded.args[0]).toBe(7n)
  })

  it('approves the vault for the exact deposit only', () => {
    const decoded = decodeFunctionData({ abi: [
      { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [
        { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' },
      ], outputs: [{ type: 'bool' }] },
    ] as const, data: approveCalldata(VAULT, '2', 18) })
    expect(String(decoded.args[0]).toLowerCase()).toBe(VAULT.toLowerCase())
    expect(decoded.args[1]).toBe(parseUnits('2', 18))
  })

  it('refuses the deposits and slippages the vault would revert', () => {
    expect(checkAmount('0', capsA)).toMatch(/positive/)
    expect(checkAmount('5', '2')).toMatch(/over this vault's cap/)
    expect(checkSlippage(0)).toMatch(/1 to/)
    expect(checkSlippage(MAX_SLIPPAGE_BPS + 1)).toMatch(/1 to/)
    expect(checkSlippage(750)).toBe(null)
    expect(checkAmount('1.5', '2')).toBe(null)
  })
})

const capsA = '2'
