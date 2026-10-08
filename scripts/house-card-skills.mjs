// Read-only: for the house chain-97 listings, pull each detail record from
// production, then its declared agent card, and print what the card claims.
import { readFileSync } from 'node:fs' // not needed, placeholder-free loop below

const API = 'https://api.agentsouk.xyz/api'
const TOKENS = [2504, 2521, 2522, 2524, 2526]

for (const id of TOKENS) {
  try {
    const res = await fetch(`${API}/agents/97/${id}`)
    const body = await res.json()
    const d = body?.data ?? body
    if (!d) { console.log(`${id}: no detail`); continue }
    const skillsTop = Array.isArray(d.skills) ? d.skills.map((s) => s.id ?? s.name) : []
    const ep = d?.services?.a2a?.endpoint ?? ''
    console.log(`\n${id} ${d.name} wallet=${d.agent_wallet} top-level skills=[${skillsTop.join(',')}]`)
    console.log(`  card endpoint: ${ep}`)
    if (ep) {
      const card = await fetch(ep)
      const c = await card.json()
      const cardName = c?.name ?? '?'
      const cardSkills = Array.isArray(c?.skills)
        ? c.skills.map((s) => `${s.id ?? s.name}: ${(s.description ?? '').slice(0, 60)}`)
        : []
      console.log(`  card name: ${cardName}`)
      for (const s of cardSkills) console.log(`  skill ${s}`)
    }
  } catch (e) {
    console.log(`${id}: failed: ${String(e.message).slice(0, 100)}`)
  }
}
