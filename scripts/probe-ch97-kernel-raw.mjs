// Raw read of the kernel: name the exact functions it answers, byte for byte.
import { createPublicClient, http, encodeFunctionData } from 'viem'
import { bscTestnet } from 'viem/chains'

const KERNEL = '0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de'
const RPC = 'https://data-seed-prebsc-2-s2.binance.org:8545'
const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) })

const sigs = {
  paymentToken: '0x90b7ab1b',
  jobCounter: '0x',
  getJob: '0x',
}
// compute selectors with viem's toFunctionSelector-free path: use keccak via wallet abi
import { toFunctionSelector } from 'viem'
const entries = [
  'paymentToken()', 'jobCounter()', 'getJob(uint256)', 'platformFeeBP()',
  'evaluatorFeeBP()', 'evaluatorFee()', 'whitelistedHooks(address)',
  'jobs(uint256)', 'platformTreasury()', 'hookWhitelist(address)',
  'supportsInterface(bytes4)', 'createJob(address,address,uint256,string,address)',
  'fund(uint256,bytes)', 'submit(uint256,bytes32,bytes)',
  'complete(uint256,bytes32,bytes)', 'reject(uint256,bytes32,bytes)',
  'claimRefund(uint256)', 'setBudget(uint256,uint256,bytes)', 'setProvider(uint256,address)',
]
for (const s of entries) {
  const data = toFunctionSelector(s) === '' ? sigs[s] : toFunctionSelector(s)
  if (!data) continue
  const argdata = s.includes('(uint256)') ? '0x' + '1'.padStart(64, '0') : s.includes('(address)') ? '0x' + '00'.repeat(20) : '0x'
  try {
    const res = await client.call({ to: KERNEL, data: data + argdata.slice(2) })
    console.log(s, '->', res.data === '0x' ? '(empty)' : res.data.slice(0, 200))
  } catch (e) {
    const msg = String(e.cause?.message ?? e.message).split('\n')[0].slice(0, 90)
    console.log(s, '-> REVERT', msg)
  }
}
