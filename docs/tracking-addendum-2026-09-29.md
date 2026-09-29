# Tracking addendum, 29 September 2026

This covers additions and corrections to `tracking-submission.md`, which was submitted on
27 September but nothing here changes what was declared. It adds three things the brief asks for and that have changed or were missing: the event signatures, a
runnable verification call, and a correction to the team wallet list.

## 1. Event signatures

The brief asks for the events that represent a hire, a deposit, a job completion
and a rating, with signatures. Settlement is one EIP-3009
`transferWithAuthorization` call on the settlement token, and it emits two events.
This is what a settled hire looks like on chain.

Settlement token, chain 97:
`0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53` (sUSD, 18 decimals)

| Event | Signature | topic0 |
|---|---|---|
| AuthorizationUsed | `AuthorizationUsed(address,bytes32)` | `0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5` |
| Transfer | `Transfer(address,address,uint256)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| AuthorizationCanceled | `AuthorizationCanceled(address,bytes32)` | `0x1cdd46ff242716cdaa72d159d339a485b3438398348d68f09d7c8c0a59353d81` |

Reading them against the four quest events:

| Quest event | Where it is proven |
|---|---|
| Hire | on chain: one `AuthorizationUsed` plus one `Transfer`, both emitted by the settlement token |
| Deposit | on chain: the `Transfer` leg. The payer is `from`, the agent's registered wallet is `to` |
| Job completion | the marketplace's own job record, which is held off chain. Job `ab91e68f-ac01-4c5f-940c-6717b9c8acf4` reached Completed on 27 September for Keel (token 2238), after Open, Funded and Submitted. Its deliverable is on `GET /api/jobs/[jobId]` and its settlement is in section 1 of the original |
| Rating | the registry feedback record, read through the API |

Only the hire, the deposit and a revocation are chain events, so those are the
only three that carry a topic hash. Completion is the marketplace's own record,
and rating comes from the registry.

`AuthorizationCanceled` appears only on a revocation, so the revocation row in
section 1 of the original carries one log and the others carry two.

## 2. A runnable verification call

Section 4 of the original gives this endpoint as a template. Here it is as a call
that returns data:

```
GET https://api.agentsouk.xyz/api/hires/by-wallet?wallet=0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713
```

It returns four hires, one in each of the four quest categories. That wallet is
the declared buyer, so the call demonstrates the query itself; the activity it
returns is ours. A wallet with no settlements returns an empty list, and the response
reports whether it answered from the durable store, so an empty answer can be
told apart from an incomplete one.

## 3. Reading the chain

The public BSC testnet RPCs are intermittent, and a read can return an empty
result for a transaction that is mined and confirmed. Section 5 of the original
says the Binance seed endpoints did not resolve; on 29 September the opposite was
observed, with `https://bsc-testnet-rpc.publicnode.com` returning empty for
confirmed transactions that `https://data-seed-prebsc-1-s1.binance.org:8545`
resolved. Neither endpoint is reliable in both directions.

The explorer links below need no RPC.

## 4. The four category proofs, verifiable without an RPC

All four are `status 0x1` on chain 97. Transaction hashes as in section 1 of the
original.

| Category | Transaction |
|---|---|
| yield | `0xbaaec7294ec276a76311168c71dff30918f99d3fd686d14df329c923fbcb20f4` |
| grid-trading | `0xb57dda246f6e8412fd5bfff5c305e94998e3d5e778426fe4b3c376bc9271c195` |
| rebalancing | `0xc62f7421a31c09dc0b45643405212ce54e61305c6c3ce4722612ffc8b6b066aa` |
| health-factor | `0xf10142bdcf534c69f18c862dd365f21ee025d60e4d1068b15a2df68d3e35d899` |

Explorer, prefix `https://testnet.bscscan.com/tx/`:

```
yield         https://testnet.bscscan.com/tx/0xbaaec7294ec276a76311168c71dff30918f99d3fd686d14df329c923fbcb20f4
grid-trading  https://testnet.bscscan.com/tx/0xb57dda246f6e8412fd5bfff5c305e94998e3d5e778426fe4b3c376bc9271c195
rebalancing   https://testnet.bscscan.com/tx/0xc62f7421a31c09dc0b45643405212ce54e61305c6c3ce4722612ffc8b6b066aa
health-factor https://testnet.bscscan.com/tx/0xf10142bdcf534c69f18c862dd365f21ee025d60e4d1068b15a2df68d3e35d899
```

## 5. Team wallets: five addresses

Section 5 of the original declares three addresses. Two more are ours and should
be excluded from quest scoring.

| Role | Address |
|---|---|
| Relay, broadcaster, pays gas | `0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4` |
| Buyer, signs authorizations | `0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713` |
| Agent owner, holds our reference listings | `0x84fedaBd1b83443aD86796C15619494878B64180` |
| Deployment wallet | `0x52DA44aB471455437fc17979c52E501f6b8d0EAF` |
| Spare identity, declared and unused | `0x5188d3b15271bD0eD56B1dE86B50198d4497c4e5` |

`GET /api/quest/progress` and `GET /api/quest/completed` count only a wallet's own
settled hires and exclude these five addresses, so the split above holds in the code
that scores the quest.

The third is the one that matters. `0x84fedaBd1b83443aD86796C15619494878B64180`
owns our five reference listings in the catalogue (tokens 2504, 2521, 2522, 2524
and 2526) and is the payer in the worked example in section 1. The original calls
it a participant in section 6, which is wrong: it is ours, and anything it does
should be read as team activity.

On-chain state, read on 2026-09-29. The public RPCs are intermittent, so which
endpoint answers varies; these reads used
`https://data-seed-prebsc-1-s1.binance.org:8545` for chain 97 and
`https://bsc-dataseed.binance.org` for chain 56.

| Address | chain 97 nonce | chain 97 balance | chain 56 nonce | chain 56 balance |
|---|---|---|---|---|
| 0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4 | 139 | 0.29170284 tBNB | 1 | 0.00408752 BNB |
| 0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713 | 0 | 0 | 0 | 0 |
| 0x84fedaBd1b83443aD86796C15619494878B64180 | 10 | 0.00044877 tBNB | 0 | 0 |
| 0x52DA44aB471455437fc17979c52E501f6b8d0EAF | 0 | 0 | 9 | 0.00008342 BNB |
| 0x5188d3b15271bD0eD56B1dE86B50198d4497c4e5 | 0 | 0 | 0 | 0 |

The relay's chain 97 nonce moved from 63 to 139 between the two reads, and the
sUSD position moved with it: the relay now holds 999,856 of the 1,000,148.5 in
circulation, against 999,956 of 1,000,099.5 on 27 September.

Two things in section 5 of the original are superseded by this section:

- The third row of the role table describes its address as "the intended
  registering owner of the agent the team will list... Currently unused". That
  description belongs to `0x5188d3b15271bD0eD56B1dE86B50198d4497c4e5`, the spare.
  The address in that row, `0x84fedaBd1b83443aD86796C15619494878B64180`, already
  owns five live listings and is described in the table above.
- The closing sentence of the spare-identity note says it "needs to be the
  registering owner of the ERC-8004 listing on chain 97". There is no plan to
  list under it; the team's listings are already registered under the agent owner
  above.

## 6. Not changed

The declared network remains BSC testnet, chain 97. The mainnet cutover to chain
56 happens after the campaign concludes; this addendum does not move it.
