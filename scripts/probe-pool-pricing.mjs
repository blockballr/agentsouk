// Pool-priced sizing probe, read only: walk router -> factory -> pool -> slot0
// on chain 97 and quote the rehearsal's funding swap from the pool's own sqrt
// price, so the min-out can stop being a hardcoded floor.
import { createPublicClient, http, formatUnits, parseUnits } from 'viem'
import { bscTestnet } from 'viem/chains'

const WBNB = '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd'
const USDT = '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd'
const ROUTER = '0x1b81D678ffb9C0263b24A97847620C99d213eB14'
const RPC = 'https://data-seed-prebsc-2-s2.binance.org:8545'
const FEE = 500

const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) })

const addrOut = [{ type: 'address' }]
const factoryCandidates = [
  { name: 'factory', inputs: [] },
  { name: 'factoryV3', inputs: [] },
  { name: 'PancakeV3PoolAddress', inputs: [] },
]

let factory = null
for (const c of factoryCandidates) {
  try {
    factory = await client.readContract({
      address: ROUTER,
      abi: [{ name: c.name, type: 'function', stateMutability: 'view', inputs: c.inputs, outputs: addrOut }],
      functionName: c.name,
    })
    console.log(`router.${c.name}():`, factory)
    break
  } catch (e) {
    console.log(`router.${c.name}():`, e.shortMessage ?? e.message)
  }
}
if (!factory) {
  console.log('no factory getter on the router; needs another discovery path')
  process.exit(1)
}

const pool = await client.readContract({
  address: factory,
  abi: [{ name: 'getPool', type: 'function', stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: addrOut }],
  functionName: 'getPool',
  args: [WBNB, USDT, FEE],
})
console.log('pool:', pool)

const slot0Abi = [{ name: 'slot0', type: 'function', stateMutability: 'view', inputs: [], outputs: [
  { type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' },
  { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }] }]
const [sqrtPriceX96] = await client.readContract({ address: pool, abi: slot0Abi, functionName: 'slot0' })
console.log('sqrtPriceX96:', sqrtPriceX96.toString())

const amountIn = parseUnits('0.05', 18)
const q96 = 1n << 96n
const wbnbIsToken0 = WBNB.toLowerCase() < USDT.toLowerCase()
console.log('token0 is', wbnbIsToken0 ? 'WBNB' : 'USDT')
const quote = wbnbIsToken0
  ? (amountIn * sqrtPriceX96 * sqrtPriceX96) / (q96 * q96)
  : (amountIn * q96 * q96) / (sqrtPriceX96 * sqrtPriceX96)
const minOut = (quote * 99n) / 100n

console.log('quote for 0.05 WBNB:', formatUnits(quote, 18), 'USDT')
console.log('minOut at 1%:', formatUnits(minOut, 18), 'USDT')
console.log('covers the 0.10 deposit:', quote >= parseUnits('0.10', 18))
