// Read-only probe of a live ERC-8183 seller's notify_funded skill: three
// payload shapes, each carrying a job id that does NOT exist on chain, so no
// seller can start work off a poisoned id. The refusal text is the schema.
const ENDPOINT = 'https://hevo-agents.fly.dev/grid/a2a'

const id = 999999999
const shapes = {
  'data part': {
    jsonrpc: '2.0', id: 1, method: 'message/send',
    params: { message: {
      role: 'user', kind: 'message', messageId: `agora-probe-${Date.now()}`,
      parts: [{ kind: 'data', data: { skill: 'notify_funded', job_id: id, chain_id: 97,
        commerce: '0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE',
        payment_token: '0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565' } }],
    } },
  },
  'metadata skill': {
    jsonrpc: '2.0', id: 2, method: 'message/send',
    params: { metadata: { skillId: 'notify_funded' }, message: {
      role: 'user', kind: 'message', messageId: `agora-probe2-${Date.now()}`,
      parts: [{ kind: 'text', text: `notify_funded: job ${id} is funded on chain 97` }],
    } },
  },
  'plain text': {
    jsonrpc: '2.0', id: 3, method: 'message/send',
    params: { message: {
      role: 'user', kind: 'message', messageId: `agora-probe3-${Date.now()}`,
      parts: [{ kind: 'text', text: `notify_funded job ${id} on chain 97 was funded on the AgenticCommerce kernel; the price was locked in escrow.` }],
    } },
  },
}

for (const [name, body] of Object.entries(shapes)) {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 15000)
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }).finally(() => clearTimeout(timer))
    const raw = await res.text()
    console.log(`--- ${name}: HTTP ${res.status}`)
    console.log(raw.slice(0, 400))
  } catch (e) {
    console.log(`--- ${name}: ${String(e.message).slice(0, 120)}`)
  }
}
