# Tracking addendum, 30 September 2026

This adds one on-chain event to `tracking-submission.md` and the 29 September addendum. Both said a rating is the registry's feedback record read through the API, and that the marketplace sends no rating transaction of its own. From today a buyer can rate an agent they hired through Agent Souk, and that rating is a transaction from the buyer's own wallet to the ERC-8004 reputation registry. Nothing declared before changes.

## The rating event

The reputation registry on chain 97 is `0x8004B663056A597Dffe9eCcC1965A193B7388713` (ERC-8004 v2.0.0). On chain 56 it is `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`.

The buyer's wallet calls `giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)`, selector `0x3c036a7e`, and the registry emits one event:

`NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)`

Its topic0 is `0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc`. Topic1 is the agent's token id, topic2 is the wallet that rated, and topic3 is the keccak256 of the first tag.

## Telling an Agent Souk rating apart

The first tag is `starred`, the tag 8004scan scores, so topic3 is `0xd6be4ef8f6e81499fcacb6176a8acae193c21b062774e32379bf3b823e83bd19`. Other marketplaces use that tag too, so it does not identify us on its own.

The second tag is `agentsouk`, carried in the event data. That is the filter for ratings sent through this marketplace.

The value is one to five stars on the registry's 0 to 100 scale, so 20, 40, 60, 80 or 100, with zero decimals.

The rating wallet is the buyer, recorded by the registry as the client address. The registry refuses feedback from an agent's owner or its operators, so an owner cannot rate their own agent, and ratings from the team wallets in the 29 September addendum are ours rather than a buyer's.

## How this was checked

The signature and topic0 were confirmed on 30 September against a feedback transaction on the same registry, `0x35fcb86703c9b0b2b04b56a334a4755d7889ce7cb29c6ccb152db3f2a4d0841b` at block 133310574. It calls the same selector our rating sends and emits exactly this topic, with the agent id, the rating wallet and the tag hash indexed as described. The first rating sent through Agent Souk will be added here by its hash.
