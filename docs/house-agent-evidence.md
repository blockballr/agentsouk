# House Agent Evidence

Purpose: record reproducible evidence that the team-owned reference agent "Souk Health Guard" (BSC testnet, chain 97, token id 2504) exists in the registry, is owned on chain by 0x84fedaBd1b83443aD86796C15619494878B64180, and answers on its declared A2A and MCP endpoints. Every probe below is a read-only liveness check. No hire, order, or payment is created by any of them.

Environment: Windows, curl 8.21.0 in PowerShell. All times are UTC, captured with `[DateTime]::UtcNow`. Response bodies are trimmed to the fields that matter.

## 1. Registry read

Command:

```
curl.exe -s "https://api.agentsouk.xyz/api/agents/by-owner?owner=0x84fedaBd1b83443aD86796C15619494878B64180"
```

Time of call: 2026-09-27T10:38:01Z.

Observed (trimmed):

```
success                 true
owner                   0x84fedaBd1b83443aD86796C15619494878B64180
chainId                 97
agents[0].tokenId       2504
agents[0].agentId       97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2504
agents[0].name          Souk Health Guard
agents[0].category      health-factor
agents[0].contractAddress 0x8004a818bfb912233c491871b3d84c89a494bd9e
agents[0].ownerAddress  0x84fedabd1b83443ad86796c15619494878b64180
agents[0].isActive      true
agents[0].isVerified    false
agents[0].x402Supported true
agents[0].createdAt     2026-09-27T10:18:21.884Z
counts.agents           1
counts.categories       {"health-factor":1}
```

The record's declared description states that the agent computes the health factor and liquidation distance of a lending position from caller-supplied collateral and debt, with an optional liquidation threshold, using deterministic arithmetic and no market data.

Shelf command:

```
curl.exe -s "https://api.agentsouk.xyz/api/agents?limit=80"
```

Time of call: 2026-09-27T10:38:02Z.

Note: the endpoint clamped the requested limit to 60 (response `limit` is 60). It still carried all current shelf entries because `total` is 22.

Observed (trimmed):

```
success                              true
chainId                              97
page                                 1
limit                                60
total                                22
items length                         22
indexStatus.catalogueSource          "store"
indexStatus.catalogueRefreshedAt     "2026-09-27T10:37:56.835Z"
indexStatus.registryTotal            2464
indexStatus.totalFetched             21
categoryCounts                       {"all":22,"yield":10,"rebalancing":5,"health-factor":4,"grid-trading":3}
```

The token appears on the shelf. Matching entry (trimmed):

```
token_id         "2504"
agent_id         "97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2504"
name             "Souk Health Guard"
category         "health-factor"
chain_id         97
owner_address    "0x84fedabd1b83443ad86796c15619494878b64180"
is_active        true
a2a_endpoint     "https://api.agentsouk.xyz/api/house-agent/.well-known/agent-card.json"
```

## 2. Chain read (BSC testnet, chain 97)

Endpoint: `https://bsc-testnet-rpc.publicnode.com` with a `User-Agent` header. The endpoint returns HTTP 403 without a User-Agent. Method: JSON-RPC `eth_call` against the registry `0x8004a818bfb912233c491871b3d84c89a494bd9e`.

`ownerOf(2504)`, selector `0x6352211e` plus the 32-byte padded id `0x09c8`:

```
curl.exe -s https://bsc-testnet-rpc.publicnode.com -H "content-type: application/json" -H "User-Agent: agora-evidence/1.0" --data-binary @ownerof.json
```

Body in `ownerof.json`:

```
{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x8004a818bfb912233c491871b3d84c89a494bd9e","data":"0x6352211e00000000000000000000000000000000000000000000000000000000000009c8"},"latest"]}
```

Time of call: 2026-09-27T10:38:27Z.

Observed:

```
{"jsonrpc":"2.0","id":1,"result":"0x00000000000000000000000084fedabd1b83443ad86796c15619494878b64180"}
```

`ownerOf(2504)` decodes to `0x84fedabd1b83443ad86796c15619494878b64180`, equal to the owner wallet above.

`tokenURI(2504)`, selector `0xc87b56dd` plus the same padded id:

Body in `tokenuri.json`:

```
{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x8004a818bfb912233c491871b3d84c89a494bd9e","data":"0xc87b56dd00000000000000000000000000000000000000000000000000000000000009c8"},"latest"]}
```

Time of call: 2026-09-27T10:38:27Z.

Observed result is an ABI-encoded string (offset 0x20, length 0x52 = 82 bytes). Decoded value:

```
https://api.agentsouk.xyz/api/agents/register/1e3264e1-d7b9-4968-af9e-384841a9b3ba
```

So the on-chain owner matches the wallet, and `tokenURI` resolves to the registry's register link for this token.

## 3. A2A liveness

Request:

```
POST https://api.agentsouk.xyz/api/house-agent/a2a
header: content-type: application/json
body:
{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","messageId":"evi-0001","parts":[{"kind":"text","text":"What is the health factor for collateral 1000 and debt 500?"}]}}}
```

Time of call: 2026-09-27T10:38:28Z.

Observed (trimmed):

```
result.task.status.state        "completed"
result.task.status.timestamp    2026-09-27T10:38:29.662Z
result.artifacts[0].name        "health-factor-result"
artifacts[0].data.inputs        {"collateral":1000,"debt":500,"liquidationThreshold":0.8}
artifacts[0].data.result.healthFactor  1.6
artifacts[0].data.result.state         "healthy"
```

First line of the agent text artefact:

```
Health factor 1.6 for collateral 1000 USD at a liquidation threshold of 0.8 and debt 500 USD.
```

## 4. MCP liveness

`tools/list`:

```
POST https://api.agentsouk.xyz/api/house-agent/mcp
headers: content-type: application/json ; accept: application/json, text/event-stream
body: {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

Time of call: 2026-09-27T10:38:50Z.

Observed tool names:

```
compute_health_factor
```

Only one tool is listed. Its input schema requires `collateral` and `debt` and accepts an optional `liquidationThreshold` (exclusive minimum 0, maximum 1, default 0.8). Annotations: readOnlyHint true, idempotentHint true, openWorldHint false.

Tool call:

```
body: {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"compute_health_factor","arguments":{"collateral":1000,"debt":500}}}
```

Time of call: 2026-09-27T10:38:51Z.

Observed (trimmed):

```
result.isError                                false
result.structuredContent.inputs               {"collateral":1000,"debt":500,"liquidationThreshold":0.8}
result.structuredContent.result.healthFactor  1.6
result.structuredContent.result.state         "healthy"
result.structuredContent.result.liquidationCapacity        800
result.structuredContent.result.liquidationDistancePercent 37.5
```

First line of the returned text:

```
Health factor 1.6 for collateral 1000 USD at a liquidation threshold of 0.8 and debt 500 USD.
```

## 5. The declared card

Request:

```
curl.exe -s https://api.agentsouk.xyz/api/house-agent/.well-known/agent-card.json
```

Time of call: 2026-09-27T10:38:52Z.

Observed (trimmed):

```
name                       "Souk Health Guard"
url                        "https://api.agentsouk.xyz/api/house-agent/a2a"
version                    "1.0.0"
protocolVersion            "0.3.0"
provider.organization      "Agent Souk"
provider.url               "https://api.agentsouk.xyz"
supportedInterfaces[0].url "https://api.agentsouk.xyz/api/house-agent/a2a"
supportedInterfaces[0].transport "JSONRPC"
skills[0].id               "compute-health-factor"
```

The card advertises the same A2A url that passed the liveness check in section 3.

## Not verified, stated plainly

- No payment was exercised. `x402Supported` is declared true in the registry, but no x402 payment or settlement flow was run, so paid execution is not evidenced by this document.
- The registry record has `isVerified` false and `verification` null. No independent verification claim is made here.
- `tokenURI(2504)` resolves to a registry register link, not a metadata document, so the on-chain metadata JSON behind that link was not fetched.
- The shelf endpoint did not honor `limit=80`; it returned `limit` 60 with all 22 current entries. Shelf membership is confirmed for the call above, but it is served from a shared index (`catalogueSource` "store") and was not cross-checked against a fresh on-chain enumeration.
- These values are as returned at the times shown and may change later.
