// Read-only probe of the shared ERC-8183 AgenticCommerce kernel on chain 97.
// Confirms it matches the reference shape quoted in the ERC before any job is placed on it.
import { createPublicClient, http, encodeFunctionData, decodeFunctionResult } from 'viem'
import { bscTestnet } from 'viem/chains'

const KERNEL = '0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de'
const RPC = 'https://data-seed-prebsc-2-s2.binance.org:8545'
const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) })

const read = async (abi, name, args = []) => {
  try {
    const res = await client.call({
      to: KERNEL,
      data: encodeFunctionData({ abi, functionName: name, args }),
    })
    return decodeFunctionResult({ abi, functionName: name, data: res.data })
  } catch (e) {
    return `refused: ${String(e.cause?.message ?? e.message).slice(0, 120)}`
  }
}

const jobShape = [
  { name: 'id', type: 'uint256' },
  { name: 'client', type: 'address' },
  { name: 'provider', type: 'address' },
  { name: 'evaluator', type: 'address' },
  { name: 'description', type: 'string' },
  { name: 'budget', type: 'uint256' },
  { name: 'expiredAt', type: 'uint256' },
  { name: 'status', type: 'uint8' },
  { name: 'hook', type: 'address' },
]
const abi = [
  { name: 'paymentToken', outputs: [{ type: 'address' }], inputs: [], type: 'function', stateMutability: 'view' },
  { name: 'jobCounter', outputs: [{ type: 'uint256' }], inputs: [], type: 'function', stateMutability: 'view' },
  { name: 'getJob', outputs: [jobShape], inputs: [{ type: 'uint256' }], type: 'function', stateMutability: 'view' },
  { name: 'platformFeeBP', outputs: [{ type: 'uint256' }], inputs: [], type: 'function', stateMutability: 'view' },
  { name: 'evaluatorFeeBP', outputs: [{ type: 'uint256' }], inputs: [], type: 'function', stateMutability: 'view' },
  { name: 'whitelistedHooks', outputs: [{ type: 'bool' }], inputs: [{ type: 'address' }], type: 'function', stateMutability: 'view' },
]

const token = await read(abi, 'paymentToken')
const counter = await read(abi, 'jobCounter')
const fee = await read(abi, 'platformFeeBP')
const evalFee = await read(abi, 'evaluatorFeeBP')
console.log('paymentToken:', token)
console.log('jobCounter:', counter)
console.log('platformFeeBP:', fee)
console.log('evaluatorFeeBP:', evalFee)
if (Number(counter) > 0) console.log('job 1:', JSON.stringify(await read(abi, 'getJob', [1n])))
const zeroHook = await read(abi, 'whitelistedHooks', ['0x0000000000000000000000000000000000000000'])
console.log('zero hook whitelisted:', zeroHook)
