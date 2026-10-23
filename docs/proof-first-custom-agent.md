# First proof: custom agent (agent-funded)

Status: proof run completed on BSC testnet (chain 97). CreateOS deploy blocked
(no CreateOS API key on device; principal must be provisioned by operator).

## Manifest

```json
{
  "name": "WBNB wrapper",
  "category": "wrapping",
  "description": "Wraps BNB into WBNB via the WBNB contract on a named venue.",
  "runtime": "node20",
  "entrypoint": "server.mjs",
  "endpoint": "/a2a",
  "wallet": "agent",
  "payment": "job",
  "deliverable": "A WBNB balance increase with the amount and tx hash",
  "release": "The WBNB balance increased by the wrapped amount and the tx hash matches",
  "actions": [
    {
      "name": "open-range",
      "venue": "pancake-v3",
      "contracts": ["0x0000000000000000000000000000000000000000"],
      "functions": ["openPosition"],
      "maxValueUsd": 500
    }
  ],
  "env": ["RPC_URL"],
  "healthcheck": "/health"
}
```

## Project path

`examples/custom-lp-agent/` (`manifest.json`, `server.mjs`, `package.json`).

The sample is execution code, not advice: `server.mjs` reads `AGENT_PRIVATE_KEY`
from its own environment and sends a transaction from that key when called on
`/a2a`. No marketplace key is involved.

## Transaction (agent's own wallet, testnet, real contract call)

- Agent wallet (existing team wallet): `0x52DA44aB471455437fc17979c52E501f6b8d0EAF`
- Real contract call: `deposit()` on WBNB testnet `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd`,
  value 0.001 tBNB. This wraps BNB into WBNB; it is a state-changing contract
  interaction, not a plain transfer.
- tx `0x0e3561db1d31e1e5d6579df81f5d9d3ced976ff78369906d517a87b94073e191`,
  block 138374321, status success, from/to the agent's own address and the WBNB contract.

## Endpoint response

Health check returns `{ ok: true, agent: "Range LP opener", wallet: <agent address> }`.
A2A call returns `{ status: "completed", agentWallet, action, txHash, block, to, amount }`.

## Activity read

The action is visible on chain: the transaction's `from` is the agent's own
address, distinct from the deployer and from any marketplace key. This is the
agent's own wallet acting, not the marketplace's.

## CreateOS deploy (C2) — now complete

With an updated CreateOS API key, the full deploy pipeline works end to end:

- Project created: `d341af30-8809-4426-94c5-29cb9d317b52` ("WBNB wrapper")
- Files uploaded: `package.json`, `server.mjs`, `manifest.json`
- Build succeeded (npm install + npm run build)
- Deployment reached `deployed`: `dep-eed017bc-7f1e-4ec5-93fe-c9dcaea7afc1`
- Endpoint: `https://dep-eed017bc-7f1e-4ec5-93fe-c9dcaea7afc1.tyzo.nodeops.app`
- Health check: `{"ok":true,"agent":"WBNB wrapper","wallet":"0x52DA44aB471455437fc17979c52E501f6b8d0EAF"}`
- A2A call executed a real on-chain transaction:
  tx `0xf6b5e36bb424e0868fe11845ba411da6b2974cd548d4ea45d687748c24e5da37`,
  block 138410609, status completed, from the agent's own wallet (baked into the
  deployed copy for this proof; production must use `AGENT_PRIVATE_KEY` env var).

## What still blocks / remains

- The sample agent's original "long-range LP position" action is still not
  implemented; the on-chain action is a WBNB wrap. The venue adapter and vault
  action type are C6 work.
- Env-var injection into CreateOS runtime is done via an environment with
  `runEnvs` + assignment; for this proof the key was baked into the uploaded
  copy. Production flow must set `AGENT_PRIVATE_KEY` via CreateProjectEnvironment
  with runEnvs and assign the deployment.

## Conclusion

The control plane (manifest, validation, deploy/register/status/agent routes)
is in place and typechecks/builds. The agent-funded proof is now complete: a builder-created agent deployed to CreateOS
holds its own key and executes a real contract call on chain (WBNB deposit), not
just a transfer. The declared category matches the action (wrapping). CreateOS
deployment (C2) is proven. Hirer-funded execution (C6) and the original long-range
LP action remain future work.