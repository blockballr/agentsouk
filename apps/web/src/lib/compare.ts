import type { AgentDetail } from '@agora/core'
import { CATEGORIES, CATEGORY_KEYS, classifyAgent } from '@agora/core'

// best-in-category selection for the compare table
// rank: on-chain total_score, then total_feedbacks, then verification
// status (delivered > gated > dead/unreachable > absent), then AI quality
// grade (good > partial > poor), then list order. every step is explainable
// from the numbers already on the table plus the badge data we surface

const VERIFICATION_RANK: Record<string, number> = {
  delivered: 3,
  gated: 2,
  dead: 1,
  unreachable: 1,
}

const GRADE_RANK: Record<string, number> = {
  good: 3,
  partial: 2,
  poor: 1,
}

export function categoryOf(agent: AgentDetail): string {
  return classifyAgent(`${agent.name} ${agent.description ?? ''}`).category
}

export interface CategoryGroup {
  category: string
  label: string
  agents: AgentDetail[]
}

// compared agents grouped by category, in the site's fixed category order
// (the four headline categories, then general); agents keep list order
// within a group
export function categoryGroups(agents: AgentDetail[]): CategoryGroup[] {
  const byKey = new Map<string, AgentDetail[]>()
  for (const a of agents) {
    const key = categoryOf(a)
    const list = byKey.get(key)
    if (list) list.push(a)
    else byKey.set(key, [a])
  }
  return [...CATEGORY_KEYS, 'general']
    .filter((key) => byKey.has(key))
    .map((key) => ({
      category: key,
      label: categoryLabel(key),
      agents: byKey.get(key) as AgentDetail[],
    }))
}

function categoryLabel(key: string): string {
  const def = CATEGORIES.find((c) => c.key === key)
  return def ? def.label : 'General'
}

// winner agent_id per category, or null when a category has fewer than two
// compared agents (nothing to compare, no highlight)
export function bestByCategory(agents: AgentDetail[]): Record<string, string | null> {
  const groups = new Map<string, number[]>()
  agents.forEach((a, i) => {
    const key = categoryOf(a)
    const indexes = groups.get(key)
    if (indexes) indexes.push(i)
    else groups.set(key, [i])
  })

  const winners: Record<string, string | null> = {}
  for (const [category, indexes] of groups) {
    if (indexes.length < 2) {
      winners[category] = null
      continue
    }
    const best = indexes.reduce((acc, i) => (ranksBetter(agents, i, acc) ? i : acc), indexes[0])
    winners[category] = agents[best].agent_id
  }
  return winners
}

// does agents[a] outrank agents[b] under the brief's exact tiebreak chain
function ranksBetter(agents: AgentDetail[], a: number, b: number): boolean {
  const x = agents[a]
  const y = agents[b]
  if (x.total_score !== y.total_score) return x.total_score > y.total_score
  if (x.total_feedbacks !== y.total_feedbacks) return x.total_feedbacks > y.total_feedbacks
  const vx = VERIFICATION_RANK[x.verification?.status ?? ''] ?? 0
  const vy = VERIFICATION_RANK[y.verification?.status ?? ''] ?? 0
  if (vx !== vy) return vx > vy
  const gx = GRADE_RANK[x.verification?.quality?.grade ?? ''] ?? 0
  const gy = GRADE_RANK[y.verification?.quality?.grade ?? ''] ?? 0
  if (gx !== gy) return gx > gy
  return false // list order wins, and a comes before b here
}
