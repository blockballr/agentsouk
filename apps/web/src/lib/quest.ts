import type { CategoryKey } from '@agora/core'
import { readJsonBody } from './api'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export interface QuestHire {
  paymentId: string
  tokenId: number | string
  agentName: string
  category: string | null
  txHash: string | null
  mode: string
  createdAt: string
}

export interface QuestListing {
  tokenId: number | string
  name: string
  category: string
}

export interface QuestAward {
  key: string
  points: number
  at: string | null
}

// one wallet's Set and Earn standing; team wallets, self hires and the verifier are excluded server-side
export interface QuestProgress {
  wallet: string
  categories: Record<string, boolean>
  hiredAllFour: boolean
  listedOne: boolean
  completed: boolean
  hires: QuestHire[]
  listings: QuestListing[]
  points: number
  awards: QuestAward[]
}

export async function getQuestProgress(wallet: string): Promise<QuestProgress> {
  const res = await fetch(`${BASE}/quest/progress?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) throw new Error(`quest progress ${res.status}`)
  const body = await readJsonBody<Partial<QuestProgress> & { success?: boolean; error?: string }>(res, 'quest progress')
  if (!body.success && body.error) throw new Error(body.error)
  return {
    wallet: body.wallet ?? wallet,
    categories: body.categories ?? {},
    hiredAllFour: Boolean(body.hiredAllFour),
    listedOne: Boolean(body.listedOne),
    completed: Boolean(body.completed),
    hires: body.hires ?? [],
    listings: body.listings ?? [],
    points: typeof body.points === 'number' ? body.points : 0,
    awards: body.awards ?? [],
  }
}

export type StepKey = 'health' | 'yield' | 'stall' | 'grid' | 'rebalancing' | 'seal'

export interface QuestAgent {
  tokenId: string
  name: string
  task?: string
  input?: Record<string, unknown>
}

export interface QuestStep {
  key: StepKey
  title: string
  category?: CategoryKey
  points: number
  // the agents a step suggests are chain 97 listings; on any other chain the step points at the category
  agents?: Record<number, { primary: QuestAgent; alternate?: QuestAgent }>
}

export const QUEST_STEPS: QuestStep[] = [
  {
    key: 'health',
    title: 'Health factor',
    category: 'health-factor',
    points: 100,
    agents: {
      97: {
        primary: {
          tokenId: '2504',
          name: 'Souk Health Guard',
          task: 'Compute the health factor for collateral 1000 USD and debt 500 USD at a liquidation threshold of 0.8.',
          input: { collateral: 1000, debt: 500, liquidationThreshold: 0.8 },
        },
        alternate: { tokenId: '2238', name: 'Keel' },
      },
    },
  },
  {
    key: 'yield',
    title: 'Yield',
    category: 'yield',
    points: 150,
    agents: {
      97: {
        primary: {
          tokenId: '2237',
          name: 'Sluicegate',
          task: 'What is the net APR for moving 10000 USD of USDT into Venus on BNB Smart Chain?',
        },
        alternate: {
          tokenId: '2521',
          name: 'Souk Yield Lens',
          task: 'Project the earnings on 5000 USD at a gross APY of 8 percent.',
          input: { principalUsd: 5000, grossApyPercent: 8 },
        },
      },
    },
  },
  { key: 'stall', title: 'Your stall', points: 300 },
  {
    key: 'grid',
    title: 'Grid trading',
    category: 'grid-trading',
    points: 100,
    agents: {
      97: {
        primary: {
          tokenId: '2522',
          name: 'Souk Grid Planner',
          task: 'Plan a grid between 550 and 650 USD with 5 levels and 100 USD per order.',
          input: { lowerUsd: 550, upperUsd: 650, levels: 5, orderSizeUsd: 100 },
        },
      },
    },
  },
  {
    key: 'rebalancing',
    title: 'Rebalancing',
    category: 'rebalancing',
    points: 100,
    agents: {
      97: {
        primary: {
          tokenId: '2524',
          name: 'Souk Drift Guard',
          task: 'Check the drift of a two-asset portfolio: 6000 USD in asset A and 4000 USD in asset B against a 50 percent target for A.',
          input: { valueAUsd: 6000, valueBUsd: 4000, targetAPercent: 50 },
        },
      },
    },
  },
  { key: 'seal', title: 'Grand seal', points: 250 },
]

export function stampsFrom(progress: QuestProgress | null): Record<StepKey, boolean> {
  const c = progress?.categories ?? {}
  return {
    health: Boolean(c['health-factor']),
    yield: Boolean(c.yield),
    stall: Boolean(progress?.listedOne),
    grid: Boolean(c['grid-trading']),
    rebalancing: Boolean(c.rebalancing),
    seal: Boolean(progress?.completed),
  }
}

// the step a quest link names, when it matches the agent the page is showing
export function questStepFor(
  key: string | null,
  chainId: number,
  tokenId: string,
): { step: QuestStep; agent: QuestAgent } | null {
  const step = QUEST_STEPS.find((s) => s.key === key)
  const pair = step?.agents?.[chainId]
  if (!step || !pair) return null
  const agent = [pair.primary, pair.alternate].find((a) => a?.tokenId === tokenId)
  return agent ? { step, agent } : null
}

// titles are cosmetic: they read the same points the server works out, and carry no value
export const RANKS: { at: number; title: string }[] = [
  { at: 0, title: 'Visitor' },
  { at: 100, title: 'Trader' },
  { at: 250, title: 'Merchant' },
  { at: 550, title: 'Stallholder' },
  { at: 750, title: 'Market maker' },
  { at: 1000, title: 'Master of the Souk' },
]

export function rankFor(points: number): { title: string; next: { at: number; title: string } | null } {
  const reached = RANKS.filter((r) => points >= r.at)
  const current = reached[reached.length - 1] ?? RANKS[0]
  return { title: current.title, next: RANKS.find((r) => r.at > points) ?? null }
}

// the quest's standing in this browser, per wallet: started, set aside, or turned down
export type QuestMode = 'active' | 'quit' | 'dismissed'

const PREFIX = 'souk.quest.v1'

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function keyFor(kind: string, wallet: string | null): string {
  return `${PREFIX}.${kind}.${wallet ? wallet.toLowerCase() : 'anon'}`
}

export function readQuestMode(wallet: string | null): QuestMode | null {
  try {
    const v = store()?.getItem(keyFor('mode', wallet))
    return v === 'active' || v === 'quit' || v === 'dismissed' ? v : null
  } catch {
    return null
  }
}

export function writeQuestMode(wallet: string | null, mode: QuestMode): void {
  try {
    store()?.setItem(keyFor('mode', wallet), mode)
    if (wallet) store()?.setItem(keyFor('mode', null), mode)
  } catch {
    // a browser without storage simply asks again next visit
  }
  notifyQuest()
}

// the stamps this browser has already shown, so only a newly earned one presses in
export function readSeenStamps(wallet: string): StepKey[] {
  try {
    const raw = store()?.getItem(keyFor('seen', wallet))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed.filter((k) => QUEST_STEPS.some((s) => s.key === k)) as StepKey[]) : []
  } catch {
    return []
  }
}

export function writeSeenStamps(wallet: string, keys: StepKey[]): void {
  try {
    store()?.setItem(keyFor('seen', wallet), JSON.stringify(keys))
  } catch {
    // replaying an animation on the next visit is the only cost
  }
}

// the points this browser last showed, so the tally and the bar move from there to the new total
export function readSeenPoints(wallet: string): number {
  try {
    const n = Number(store()?.getItem(keyFor('points', wallet)) ?? 0)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function writeSeenPoints(wallet: string, points: number): void {
  try {
    store()?.setItem(keyFor('points', wallet), String(points))
  } catch {
    // the tally simply counts up from zero next time
  }
}

let latest: QuestProgress | null = null
const listeners = new Set<() => void>()

export function latestQuestProgress(): QuestProgress | null {
  return latest
}

export function rememberQuestProgress(progress: QuestProgress | null): void {
  latest = progress
  notifyQuest()
}

export function subscribeQuest(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyQuest(): void {
  for (const l of listeners) l()
}
