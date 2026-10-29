# Set and Earn tracking submission

Agent Souk
Storefront: https://agentsouk.xyz
API: https://api.agentsouk.xyz
Network: BNB Smart Chain mainnet, chain 56. Testnet records, where present, carry chainId 97.

This document answers item 6 of the brief, tracking, and nothing else.

## 1. Contract addresses on BSC mainnet

| Contract | Address |
| --- | --- |
| Agent identity registry, ERC-8004 | `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` |
| Reputation registry, ERC-8004 | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Escrow funder, x402 and EIP-3009 | `0xd7052516ae58188271c4c85fa4cd69a18c6e7f8b` |
| Escrow funder, earlier deployment used by two mainnet hires | `0xfbcdac016763230768241e566e7fa0ee25bc615b` |
| HireVault, custody for first party agents | `0x028129c230123a46f4305ce0d2b29f8ac5255149` |
| Settlement asset, $U | `0xcE24439F2D9C6a2289F741120FE202248B666666` |

## 2. Events

Signatures are the exact declarations in `contracts/src/EIP3009Funder.sol` and
`contracts/src/HireVault.sol`. Each topic0 below was recomputed with keccak256
and compared against the deployed contract's logs.

| Quest event | Contract | Signature | topic0 |
| --- | --- | --- | --- |
| Hire | escrow funder | `JobFunded(bytes32 indexed jobId, address indexed buyer, address indexed payTo, address token, uint256 amount)` | `0x8de1432433770e513f4174e6b5a61a50494af660bd37230deef98fb49ea04880` |
| Deposit | escrow funder | same `JobFunded`, the `amount` is the funded leg | `0x8de1432433770e513f4174e6b5a61a50494af660bd37230deef98fb49ea04880` |
| Deposit, token leg | $U | `Transfer(address indexed from, address indexed to, uint256 value)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| Hire, vault path | HireVault | `Opened(uint256 indexed id, address indexed buyer, address indexed agent, address token, uint256 amount, uint64 expiry, uint16 maxSlippageBps, uint16 agentFeeBps, uint16 maxLossBps)` | `0xc6e7c49a9abe92a3a31350e90440923cff969c92884f0b2bf6d8834682319240` |
| Job completion, delivery verified | escrow funder | `JobVerified(bytes32 indexed jobId, bytes32 indexed receiptId, uint64 verifiedAt)` | `0x8cc8bea8f26291fe3941489af18f60e9745d15f1da5178bd673beacbb47c037a` |
| Job completion, funds released | escrow funder | `JobReleased(bytes32 indexed jobId, address indexed payTo, uint256 amount)` | `0x69dc5b5b0868890e5d51ac77964293ac42461990f49816061b0e058819f37e9e` |
| Job completion, vault path | HireVault | `Closed(uint256 indexed id, address indexed buyer, address indexed agent, uint256 amountA, uint256 amountB, uint256 deployedB, uint256 agentFee)` | `0xa20b378f755f2e9eb47ddbc3dba0c4cdc3a0a15ffb57618cee2fa6d2a0ede4fa` |
| Refund | escrow funder | `JobRefunded(bytes32 indexed jobId, address indexed buyer, uint256 amount)` | `0xa29cbf249cfa7f4623dd9da8fb1b5a81ce77895327f92a86a8539d4b823333a6` |

Hire and deposit are one transaction on this marketplace: the buyer's
authorization funds the job, and `JobFunded` carries the amount.

**What has fired on mainnet:**

- Three x402 hires, all settled. Each transaction carries `JobFunded` and the
  `$U` `Transfer` of the funded leg:
  `0x916bc08e281abb2cc404a29602bd616f84d28e629b29b6f8d7b0a6a672946768`,
  `0xf2eaaa36d47d23b887f89e28891ffddc6da11bc143207943e523792e5e2c86cb`,
  `0xcecf4f52efb35e42c1147f89551515ea89b453d8267bc7aa76e2da310249f50a`.
- Two vault hires on mainnet, ids 1 and 2, both with buyer
  `0x52DA44aB471455437fc17979c52E501f6b8d0EAF` and agent
  `0x5d328e476F9D81Bb52DBAA37895804775e49731f`, each funded with 10 units
  and both now `open: false`. That means `Opened` and `Closed` ran for each.
  Both are readable at `hire(1)` and `hire(2)` on the vault, and hire 2's trade
  at block 129974573 is
  `0xdecac4060bd6bbe599913a55b374ddf65f8f4804adb42263a42a0a3dcab396f5`.
  Its receipts are served at
  `GET /api/vault/receipts?chainId=56&hireId=2`.
- No escrow hire has reached `JobVerified`, `JobReleased` or `JobRefunded` yet.

**Rating has no onchain event in this build.** A buyer signs a rating message
with their wallet, the API verifies the signature and stores one rating per
paymentId. Ratings are read at `GET /api/ratings?chainId=56&tokenId=<id>`.
ERC-8004 feedback on the reputation registry is the onchain alternative, but no
feedback has been written for an agent here, so there is no feedback transaction
to point at.

## 3. Agent IDs and owner wallets

Agent IDs use the form `chainId:registry:tokenId`, for example
`56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:376593`.

Each record carries two wallets, kept separate:

- `ownerAddress`, the registry owner, read from ERC-8004 `ownerOf`.
- `agentWallet`, the wallet the agent acts with, read from the registry record.

A hire record stores the client wallet, the paymentId, chainId, tokenId, the
transaction hash, the mode and the timestamps. Categories are assigned by the
classifier in `src/lib/categories.ts` and stored on each record.

## 4. API endpoints

Read only, no authentication, JSON. Base URL `https://api.agentsouk.xyz`.

Hires per wallet:

```
GET /api/hires/by-wallet?wallet=<client address>
```

Returns one row per hire with `paymentId`, `chainId`, `tokenId`, `agentName`,
`category`, `client`, `txHash`, `mode`, `createdAt` and `expiresAt`.

Agents per owner:

```
GET /api/agents/by-owner?owner=<owner address>
```

Returns each agent with `chainId`, `tokenId`, `agentId`, `name`, `category`,
`contractAddress`, `ownerAddress` and `agentWallet`.

Both return 400 with `{ "success": false, "error": ... }` when the query
parameter is missing.

## 5. Team wallets

| Role | Address |
| --- | --- |
| Relay, broadcasts settlements and pays gas | `0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4` |
| Buyer, signs the EIP-3009 authorizations | `0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713` |
| Owner of the marketplace's own listings | `0x84fedaBd1b83443aD86796C15619494878B64180` |
| Retired deployer | `0x52DA44aB471455437fc17979c52E501f6b8d0EAF` |
| Declared team identity, unused | `0x5188d3b15271bD0eD56B1dE86B50198d4497c4e5` |
