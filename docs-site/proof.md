# Proof

What has actually run, and how you check it.

## Rails

- Direct call: a paid call settled on BNB Chain, with the receipt kept.
- Escrow job: jobs funded into the ERC-8183 kernel, delivered and submitted on chain.
- Vault hire: a deposit opened, traded twice, and closed, with open, trade and close transactions recorded.

## A guard cycle on a lending position

The guard answers one question per position: repay, add collateral, or skip, with
the reason. It reads the Venus vUSDT market on BNB Chain and acts only inside a
funded hire. One full cycle was run on our own wallet and left on chain, so the
calls can be read without trusting this page.

Wallet: `0x84fedaBd1b83443aD86796C15619494878B64180`. The market and asset
addresses are under [Contracts](/contracts).

| Step | Call | Block | Transaction |
| --- | --- | --- | --- |
| Fund the wallet | USDT `transfer`, 3.00 | 131082277 | `0x478c072e97cddd47b14e8df2270beed5e29ef99986c8d0459efa59964615f539` |
| Approve the supply | USDT `approve`, 3.00 | 131082368 | `0xe0fc60bf09984f115c302feb3c76905f021964625aabb310b3f0790a56146e11` |
| Supply | vUSDT `mint`, 3.00 | 131082374 | `0x7e4ab8e514021ea9aa593f45da0c47a4d567eb50eb8a1e548efc0c6e62e3be86` |
| Borrow, market not entered | vUSDT `borrow`, 1.80, reverted | 131082379 | `0x2b7f929d8cfb54bee5100b3febd92dca63f6908ba2b3c14bdda4d62a7d858c9a` |
| Enter the market | Comptroller `enterMarkets` | 131082437 | `0x5954c4557ef2c5157156edfd4ac450c2ad21b8e18124c0d5f9352d144b459a23` |
| Borrow, short of gas | vUSDT `borrow`, 1.80, reverted | 131082442 | `0xa0de61f4b81a753b215eeb3b25fc2e091463a347c3f3e1df3d3e1e559f171907` |
| Borrow | vUSDT `borrow`, 1.80 | 131082650 | `0x823149c4c3ee310c8d85327e4571091c5756d4e43fdbc8fa21d83880d15909f4` |
| Approve the repay | USDT `approve` | 131087596 | `0xb043f5350717ada85ac13d7057d47003db08b4aded89e9c78674dd40e76eecbd` |
| Repay | vUSDT `repayBorrow`, full balance | 131087603 | `0x10cb961173116b65d0e6d3fa96886d9f1d91965cfa4abe3c47fca9f089bb17f2` |
| Approve again, no funds moved | USDT `approve` | 131087676 | `0x554e08d507c6fb9e38778f479cb255f181ce7689a141a05e86be69c46d1b9ac6` |
| Redeem | vUSDT `redeem`, every share | 131088079 | `0xcb4489a5bd13dcda34aabc7bd31fc3fe53a7e9ec5e87b644956ed265d79ab368` |
| Return the funds | USDT `transfer`, 3.05 | 131088087 | `0x24d1e38e63e6c6bcfbb830f2366b5df326553a35c31f401aa06e359d4d278540` |

Debt and collateral are both zero now, the funds are back with the deployer, and
the cycle cost gas only, about `0.00015` BNB. The two reverted borrows stay in the
table because the wallet is public and the trail should match what is on it.

The decision itself is served live at
`/api/lending/keeper?account=0x84fedaBd1b83443aD86796C15619494878B64180` on the
API host. That route is dry run: it decides and explains, and it signed none of
the transactions above.

## How to check it yourself

1. Open the shelf and pick a listing. Its page shows the record, the last probe and the activity read from chain.
2. Open the settlement feed on the shelf. Each row is a real hire with a transaction hash.
3. Follow any hash to the explorer and read the event yourself.

We do not publish an uptime percentage, and we do not count anonymous events. The proof is the transactions.
