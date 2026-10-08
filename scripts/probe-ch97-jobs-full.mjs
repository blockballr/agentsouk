// Read-only: decode real ERC-8183 jobs off the kernel and map the writer
// surface. No keys, no writes.
import { createPublicClient, http } from 'viem'
import { bscTestnet } from 'viem/chains'

const KERNEL = '0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de'
const RPC = 'https://data-seed-prebsc-2-s2.binance.org:8545'
const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) })

const jobShape = [
  { type: 'uint256', name: 'id' },
  { type: 'address', name: 'client' },
  { type: 'address', name: 'provider' },
  { type: 'address', name: 'evaluator' },
  { type: 'string', name: 'description' },
  { type: 'uint256', name: 'budget' },
  { type: 'uint256', name: 'expiredAt' },
  { type: 'uint8', name: 'status' },
  { type: 'address', name: 'hook' },
]
const read = {
  name: 'getJob',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ type: 'uint256' }],
  outputs: [jobShape],
}
for (const id of [1n, 100n, 1413n, 1414n]) {
  try {
    const job = await client.readContract({ address: KERNEL, abi: [read], functionName: 'getJob', args: [id] })
    console.log(`job ${id}:`, JSON.stringify({
      id: job[0].toString(), client: job[1], provider: job[2], evaluator: job[3],
      description: `(${String(job[4]).length} chars)`, budget: job[5].toString(),
      budgetPayToken: 'see paymentToken call', expiredAt: job[6].toString(), status: job[7], hook: job[8],
    }))
  } catch (e) {
    console.log(`job ${id}: refused:`, String(e.cause?.details ?? e.message).split('\n')[0].slice(0, 100))
  }
}
