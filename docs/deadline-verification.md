# Deadline verification

Purpose: record what is actually true of Agent Souk at the 2026-09-27 deadline, one command and one observed result per line, so the submission's technical claims can be checked rather than asserted.

Verified 2026-09-27 between 11:02 and 11:05 UTC. Every result below is copied from the run described by the command directly above it. If a check failed or is absent, that is stated, not softened.

## 1. Tree is green

```
npx vitest run
```

Observed: 52 test files passed (52), 470 tests passed (470), exit code 0. Duration 39.03s.

```
npx tsc --noEmit
```

Observed: exit code 0, no diagnostics. The only stderr text was npm notice lines.

## 2. Catalogue freshness

```
curl -s "https://api.agentsouk.xyz/api/agents?limit=80"
```

Called twice, 65 seconds apart.

Call 1, sent 2026-09-27T11:03:29Z:
- total: 22
- indexStatus.catalogueSource: store
- indexStatus.catalogueRefreshedAt: 2026-09-27T11:03:04.934Z
- indexStatus.registryTotal: 2464

Call 2, sent 2026-09-27T11:04:36Z:
- total: 22
- indexStatus.catalogueSource: store
- indexStatus.catalogueRefreshedAt: 2026-09-27T11:04:16.424Z
- indexStatus.registryTotal: 2464

Observed: catalogueRefreshedAt advanced from 11:03:04.934Z to 11:04:16.424Z between the two calls. The refresh time moved forward on a read, which is the evidence that the TTL read is live. An earlier call at 11:02:15.606Z showed the same value pattern and total 22.

## 3. Reference agent

```
curl -s "https://api.agentsouk.xyz/api/agents/by-owner?owner=0x84fedaBd1b83443aD86796C15619494878B64180"
```

Observed:
- tokenId: 2504
- category: health-factor
- name: Souk Health Guard
- ownerAddress: 0x84fedabd1b83443ad86796c15619494878b64180
- counts.agents: 1

Observed in the shelf call of check 2: the item with token_id 2504, agent_id 97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2504, category health-factor, name Souk Health Guard, is present among the 22 items returned by `agents?limit=80`. So the reference agent does appear in the shelf.

## 4. Chain reads (BSC testnet, chain 97)

All requests sent to https://bsc-testnet-rpc.publicnode.com with a User-Agent header.

Read ownerOf(2504) on the registry 0x8004a818bfb912233c491871b3d84c89a494bd9e, selector 0x6352211e:

```
curl -s -X POST https://bsc-testnet-rpc.publicnode.com \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: deadline-verification' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x8004a818bfb912233c491871b3d84c89a494bd9e","data":"0x6352211e00000000000000000000000000000000000000000000000000000000000009c8"},"latest"]}'
```

Observed result: 0x00000000000000000000000084fedabd1b83443ad86796c15619494878b64180. The owner of token 2504 is 0x84fedabd1b83443ad86796c15619494878b64180, the same address as the by-owner query in check 3.

Read the settled hire transaction 0x6d5c3de6016ed3cf4e5671447e7fa82066396d8a22a131890d3d64ea706d59a6, input selector:

```
curl -s -X POST https://bsc-testnet-rpc.publicnode.com \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: deadline-verification' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["0x6d5c3de6016ed3cf4e5671447e7fa82066396d8a22a131890d3d64ea706d59a6"]}'
```

Observed input selector: 0xe3ee160e.

Read the receipt:

```
curl -s -X POST https://bsc-testnet-rpc.publicnode.com \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: deadline-verification' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x6d5c3de6016ed3cf4e5671447e7fa82066396d8a22a131890d3d64ea706d59a6"]}'
```

Observed: status 0x1, blockNumber 0x7f33bf5, to 0x9332b1aa9b3d5826f0b9b9e1659d962d2da13a53.

So the settled hire has status 0x1 and selector 0xe3ee160e, as expected.

## 5. Scheduled refresh runs

```
gh run list --repo blockballr/agentsouk --workflow refresh-catalogue.yml --limit 5
```

Observed: `[]`. No run of refresh-catalogue.yml has happened. The workflow file defines `cron: "*/15 * * * *"`, that is every fifteen minutes, plus a `workflow_dispatch` manual trigger. Because no run appears, the scheduled refresh has not yet produced a history entry, so the schedule firing is not verified.

## 6. Site and API answer

```
curl -s -o /dev/null -w '%{http_code}\n' https://agentsouk.xyz/
curl -s -o /dev/null -w '%{http_code}\n' "https://api.agentsouk.xyz/api/agents?limit=1"
```

Observed:
- https://agentsouk.xyz/ returned 200
- https://api.agentsouk.xyz/api/agents?limit=1 returned 200

## Not verified

- Email notification path. It is not configured, so nothing was sent and no inbox could be checked. Any claim that depends on a notification email arriving is unverified.
- Direct production database reads. There is no database credential or direct connection available, so row level state behind the API cannot be inspected. Every data claim here rests on what the HTTP API returned, not on the underlying tables.
- A scheduled refresh actually firing. Check 5 shows no run in the repository history. The TTL refresh observed in check 2 is the read path only, not proof that the cron job ran.
- The deadline itself and the contents of the submission. Neither was checked here.
