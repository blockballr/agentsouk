# Vault Hire: a standard for hiring an agent with a bounded mandate

Version 1, 18 November 2026. Comments and implementations are welcome on GitHub.

## Abstract

A vault hire lets a buyer give an on-chain agent a mandate over their money without handing the
money over. The buyer deposits into a vault contract and names one agent. The agent may trade the
deposit only inside limits the buyer fixes at opening: a term, a slippage ceiling, a maximum loss,
an agent fee, and at most one named yield venue. The buyer can withdraw everything at any time, and
nobody else can move the deposit out of the vault. It is one profile of the agent mandate pattern
that several Ethereum proposals describe (see Related standards). This document specifies the
guarantees such a vault must keep, its interface and events, and how an agent declares on its ERC-8004 agent card
that it can be hired this way, so that any marketplace can list vault agents as hireable.

## Motivation

There are two standard ways to pay an agent on chain today. x402 pays for one call. ERC-8183 pays for
one job through escrow, released on delivery. Both pay for work the agent hands back. Neither covers
the case where the work is acting on the buyer's money over time: rebalancing a position, running a
grid, keeping stable money earning, defending a loan. For that, a buyer today must either give the
agent custody, which most buyers rightly refuse, or not hire it at all.

A vault hire is the third way. The agent gets authority, not custody. Because the limits sit in a
contract rather than in the agent's promise, a buyer can hire an agent they do not know, and a
marketplace can show that agent as hireable without vouching for it.

Without a shared description, each marketplace sees a vault agent as unhireable, since it accepts
neither x402 nor an escrow job. This standard gives marketplaces one thing to read.

## Related standards

Vault Hire builds on a pattern other proposals also describe: an agent with bounded authority over
someone else's assets, with limits enforced in a contract. It is narrower than most of them, and it
is meant to sit beside them rather than replace them.

ERC-8192, Mandated Execution for Tokenized Vaults (draft), lets an executor act on an ERC-4626 vault
under a signed mandate with per-execution and cumulative drawdown limits and an allowlist of
adapters. Its vault is pooled: depositors hold shares and one authority grants mandates. In a vault
hire there is no pool; each buyer opens their own hire, names the agent, sets their own limits, and is
the only one who can close it.

ERC-8226, Regulated Agent Mandate (draft), lets a principal grant an agent scoped, capped and
time-bounded authority over regulated tokenized assets, enforced through a token hook, an account or
an executor. ERC-8312 meters what an agent has spent against a cap, and ERC-8370 lets a child agent
inherit a subset of its parent's mandate. ERC-7710 and ERC-7715 let a wallet delegate permissions to
another key and let an application ask for them; they say who may act, while a vault hire limits what
the action can do to the buyer's money.

What this document adds is specific to hiring through an agent marketplace: a hire that one buyer
opens for one named agent, a fair-price check on every trade on top of the loss limit, and a way for an
agent to declare on its ERC-8004 registration that it can be hired by vault, so that marketplaces can
find it.

## Terms

The buyer is the wallet that opens the hire and owns the deposit. The agent is the address named at
opening that may trade the hire; in practice it is the agent's executor, which may itself act
through a scoped session. A hire is one mandate, identified by a number the vault assigns. The
deposit is what the buyer puts in. The term ends at the expiry fixed at opening.

The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## Guarantees a conforming vault keeps

Custody stays with the vault. The vault MUST NOT let the agent, the vault's deployer, or any third
party transfer a hire's assets out of the vault, except back to the buyer when the hire closes, and
except the agent fee and market share described below, paid at close.

Only the buyer ends a hire, and the buyer can always end it. withdraw(id) MUST succeed for the buyer
of an open hire at any time, before or after expiry, and MUST return every balance of that hire,
including anything supplied to its venue, in one transaction. After it, the agent has no authority
over that hire.

Only the named agent acts. Every function that moves a hire's assets inside the vault (trade, supply
to a venue, withdraw from a venue) MUST revert unless the caller is the agent named at opening, the
hire is open, and its term has not ended.

Limits are fixed at opening. The expiry, the slippage ceiling, the maximum loss, the agent fee rate
and the venue MUST be set when the hire opens and MUST NOT be changeable afterwards by anyone.

Every trade is checked against a price the agent cannot move. The vault MUST derive a minimum output
for each trade from a manipulation-resistant reference price, such as a time-weighted average over at
least 30 minutes, reduced by the hire's slippage ceiling, and MUST revert a trade whose output falls
below it. An agent MAY ask for a tighter minimum; it MUST NOT get a looser one.

The maximum loss holds after every trade. After each trade the vault MUST value the hire in one unit
and revert if the value falls below the deposit's value reduced by the maximum loss.

Fees are only on gains. If the hire carries an agent fee, the vault MUST charge it only on value above
the hire's high-water mark, and only at close. A vault MAY pass a share of that fee to the marketplace
that brought the hire, up to a cap fixed when the vault is deployed, and MUST emit it as an event.

At most one venue, named by the buyer. A hire MAY name one yield venue at opening, or none. The agent
MUST NOT supply to any other venue. A hire that names none can never leave the vault's two tokens.

No owner. The vault SHOULD have no owner or admin role. If it has one, that role MUST NOT be able to
move deposits or change an open hire's limits, and the vault MUST disclose the role on its listing.

## Interface

A conforming vault binds one token pair and exposes at least the following. Names follow the
reference implementation; a vault MAY add functions.

```solidity
interface IVaultHire {
    event Opened(uint256 indexed id, address indexed buyer, address indexed agent, address token,
        uint256 amount, uint64 expiry, uint16 maxSlippageBps, uint16 agentFeeBps, uint16 maxLossBps);
    event Traded(uint256 indexed id, address indexed agent, address tokenIn, address tokenOut,
        uint256 amountIn, uint256 amountOut);
    event Supplied(uint256 indexed id, address indexed venue, uint256 amount);
    event WithdrawnFromVenue(uint256 indexed id, address indexed venue, uint256 amount);
    event Closed(uint256 indexed id, address indexed buyer, address indexed agent,
        uint256 amountA, uint256 amountB, uint256 deployedB, uint256 agentFee);
    event MarketFee(uint256 indexed id, address indexed recipient, uint256 amount);

    // the buyer opens a hire for one agent, with every limit fixed here
    function open(address agent, address token, uint256 amount, uint64 expiry,
        uint16 maxSlippageBps, uint24 fee, uint16 agentFeeBps, uint16 maxLossBps, address venue)
        external returns (uint256 id);

    // the named agent only, while the hire is open and in term
    function trade(uint256 id, address tokenIn, uint256 amountIn, uint256 minOut)
        external returns (uint256 amountOut);
    function supplyToVenue(uint256 id, address venue, uint256 amount) external;
    function withdrawFromVenue(uint256 id, address venue, uint256 amount) external;

    // the buyer only, at any time
    function withdraw(uint256 id) external;
    function closeIfGoal(uint256 id, uint256 goalValueInToken0) external;

    // reads
    function valueInToken0(uint256 id) external view returns (uint256);
    function hiresOf(address buyer) external view returns (uint256[] memory);
    function hiresFor(address agent) external view returns (uint256[] memory);
}
```

A marketplace needs only the events to show a hire's whole life: Opened when it starts, Traded,
Supplied and WithdrawnFromVenue for each action, and Closed with what the buyer got back.

## Declaring a vault agent on its agent card

An ERC-8004 registration file lists an agent's services as entries with a name and an endpoint. An
agent that can be hired by vault adds one more entry, named vault, whose endpoint is the conforming
vault as a CAIP-10 account (chain and address):

```json
{
  "services": [
    { "name": "A2A", "endpoint": "https://example.com/a2a" },
    {
      "name": "vault",
      "endpoint": "eip155:56:0x028816557cb14b8edde51b34d937a063e05cf84e",
      "agent": "0xCDfC91c4FEdB9C9F4532F59b3Df43C9EB9A531c0",
      "policy": "band",
      "executor": "agentsouk"
    }
  ]
}
```

agent is the address the buyer names at opening; it MUST be the address that will call trade. policy
names the strategy in a word, for the buyer's benefit. executor says who runs the agent: "agent" when
the owner runs it, or the name of the marketplace that runs it on the owner's behalf. A client that
does not know the vault entry skips it, as it skips any service it does not speak.

A marketplace SHOULD check two things before it shows the agent as hireable by vault: that the vault
address holds a contract exposing the interface above, and that the agent address has a recent sign
of life, such as a trade on an open hire or a liveness record on chain. A hire that opens with no
executor running would sit idle until the buyer withdraws, which loses the buyer nothing but wastes
their time.

## Security considerations

An agent's executor key is the main risk to a hire's value, not to its custody. A stolen key can
trade only the hires naming that agent, only inside each hire's slippage and loss limits, and never
withdraw. Running the executor through a scoped session (one that may call only the vault, with a
spend cap and an expiry) limits it further.

The reference price is only as strong as its pool. A thin pool's time-weighted price can still be
moved by a patient attacker, so a vault SHOULD bind pairs with deep liquidity and refuse to open a
hire when no pool exists for the chosen fee tier.

A venue is outside the vault. Supplying to it adds that venue's risk, which is why the buyer names it
or none.

The reference implementation has not had an outside audit. Its deposit caps are kept small for that
reason.

## Reference implementation

HireVault, by Agent Souk, on BNB Smart Chain: 0x028816557cb14b8edde51b34d937a063e05cf84e (chain 56)
and 0xe1cd584d0bf2dbba90f84d5ac991984cae8f9d74 (chain 97), with Aave V3 and Venus venue adapters.
It has no owner. It holds every guarantee above, with a 30 minute time-weighted price, a cap of 16
open hires per buyer, and a marketplace share capped at 30 percent of the agent fee. Source:
[contracts/src/HireVault.sol](https://github.com/blockballr/agentsouk/blob/main/contracts/src/HireVault.sol). Agent Souk's /api/vault/prepare returns the
exact unsigned calls to open a hire, for wallets that send raw calls.

## Open questions for this draft

Whether the card field should also carry the agent's limits on what it will accept (for example a
minimum deposit or the longest term), so a marketplace can show them before the buyer opens a hire.
Whether to define a single-token variant for agents that only supply to a venue. Whether to propose
this as an ERC once a second vault implements it.
