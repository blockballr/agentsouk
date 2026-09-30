// sellers on BNB Chain's agent SDK, Agent Studio's included, take work only through an ERC-8183 job;
// a card that also declares a skill of its own takes direct tasks too, so it does not count

interface SkillLike {
  id?: string
  name?: string
  description?: string
}

const NEGOTIATE = /^negotiate(-erc8183-job)?$/i
const NEGOTIATION = /^(negotiate(-erc8183-job)?|notify_funded)$/i

export function sellsByJob(skills: SkillLike[] | null | undefined): boolean {
  if (!Array.isArray(skills) || skills.length === 0) return false
  const names = skills.map((s) => (s.id ?? s.name ?? '').trim())
  const at = names.findIndex((n) => NEGOTIATE.test(n))
  if (at < 0) return false
  if (!names.every((n) => NEGOTIATION.test(n))) return false
  return names.some((n) => /^notify_funded$/i.test(n)) || /8183/.test(skills[at].description ?? '')
}

export const JOB_SELLER_NOTE =
  'This agent sells through ERC-8183 jobs on BNB Chain’s own contracts. It quotes a price and starts work once a job is funded on chain, so it cannot take a direct paid task, and a direct hire would reach its wallet with nothing delivered. Hiring job sellers on Agent Souk is being built.'
