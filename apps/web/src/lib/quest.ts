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
  // how many different agents this wallet has hired here, and how many the passport asks for
  agentsHired: number
  requiredHires: number
  // one of our own wallets, which never earns a stamp
  team: boolean
  listedOne: boolean
  completed: boolean
  hires: QuestHire[]
  listings: QuestListing[]
  points: number
  awards: QuestAward[]
  // the number issued to a wallet once its passport is complete
  passport?: { serial: string; number: number; issuedAt: string } | null
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
    agentsHired: typeof body.agentsHired === 'number' ? body.agentsHired : 0,
    requiredHires: typeof body.requiredHires === 'number' ? body.requiredHires : 2,
    team: Boolean(body.team),
    listedOne: Boolean(body.listedOne),
    completed: Boolean(body.completed),
    hires: body.hires ?? [],
    listings: body.listings ?? [],
    points: typeof body.points === 'number' ? body.points : 0,
    awards: body.awards ?? [],
    passport: body.passport ?? null,
  }
}

// the passport is three stamps: a hire, a stall of your own, and a second hire
export type StepKey = 'first' | 'stall' | 'second'

export interface QuestAgent {
  tokenId: string
  name: string
  task?: string
  input?: Record<string, unknown>
  // the registry owner, when the pick came from the live shelf
  owner?: string | null
  imageUrl?: string | null
  // the price the seller declares, as written; null means it only quotes at hire
  price?: string | null
}

// an agent the server offers for a step
export interface QuestCandidate {
  tokenId: string
  name: string
  owner?: string | null
  imageUrl?: string | null
  price?: string | null
}

// what a step may offer in one category, in the order the shelf rotated them for this visit:
// agents a job has completed on, and every agent that answered its last check
export interface QuestShelf {
  confirmed: QuestCandidate[]
  working: QuestCandidate[]
}

export async function getQuestShelf(seed: string): Promise<Record<string, QuestShelf>> {
  const res = await fetch(`${BASE}/quest/picks?seed=${encodeURIComponent(seed)}`)
  if (!res.ok) throw new Error(`quest picks ${res.status}`)
  const body = await readJsonBody<{ picks?: Record<string, Partial<QuestShelf>> }>(res, 'quest picks')
  const out: Record<string, QuestShelf> = {}
  for (const [category, shelf] of Object.entries(body.picks ?? {})) {
    out[category] = { confirmed: shelf.confirmed ?? [], working: shelf.working ?? [] }
  }
  return out
}

export interface QuestStep {
  key: StepKey
  title: string
  // a hire step suggests agents from one category; an agent of any category counts for it
  category?: CategoryKey
  // the agents a step suggests are chain 97 listings; on any other chain the step points at the category
  agents?: Record<number, { primary: QuestAgent; alternate?: QuestAgent }>
}

export const QUEST_STEPS: QuestStep[] = [
  {
    key: 'first',
    title: 'First hire',
    category: 'health-factor',
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
      56: {
        primary: {
          tokenId: '368655',
          name: 'Souk Drift Guard',
          task: 'Fund a vault hire with 100 USDT and let the guard keep the position in range.',
        },
      },
    },
  },
  { key: 'stall', title: 'Your stall' },
  {
    key: 'second',
    title: 'Second hire',
    category: 'yield',
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
      56: {
        primary: {
          tokenId: '391003',
          name: 'Souk Yield Lens',
          task: 'Fund a vault hire with 100 USDT and let the agent route to the highest yield.',
        },
      },
    },
  },
]

// hire stamps go by how many different agents were hired, not by which category they were in
export function stampsFrom(progress: QuestProgress | null): Record<StepKey, boolean> {
  const hired = progress?.agentsHired ?? 0
  return {
    first: hired >= 1,
    stall: Boolean(progress?.listedOne),
    second: hired >= 2,
  }
}

// how far along the three things that finish a passport are
export function requiredDone(progress: QuestProgress | null): number {
  const s = stampsFrom(progress)
  return [s.first, s.stall, s.second].filter(Boolean).length
}

// the hire step a quest link names. Any agent can be the one hired for it; the task is
// filled in only for the agents whose input we know
export function questStepFor(
  key: string | null,
  chainId: number,
  tokenId: string,
): { step: QuestStep; agent: QuestAgent } | null {
  const step = QUEST_STEPS.find((s) => s.key === key)
  if (!step?.category) return null
  const pair = step.agents?.[chainId]
  const known = [pair?.primary, pair?.alternate].find((a) => a?.tokenId === tokenId)
  return { step, agent: known ?? { tokenId, name: '' } }
}

// who a hire step offers: one agent, never the visitor's own and never one already hired.
// Agents a job has completed on come first, in the shelf's rotated order, so any listing can
// be featured once it is proven. A category with no escrow agent is left empty rather than
// falling back to a direct-only seller: the card says so instead of sending a buyer elsewhere.
export function questPicks(
  step: QuestStep,
  chainId: number,
  shelf: QuestShelf | undefined,
  wallet: string | null,
  exclude: ReadonlySet<string> = new Set(),
): QuestAgent[] {
  const pair = step.agents?.[chainId]
  const written = [pair?.primary, pair?.alternate].filter((a): a is QuestAgent => Boolean(a))
  const writtenById = new Map(written.map((a) => [a.tokenId, a]))
  const me = wallet?.toLowerCase() ?? null
  const offer = (list: QuestCandidate[]): QuestAgent[] =>
    list
      .filter((a) => !me || a.owner?.toLowerCase() !== me)
      .filter((a) => !exclude.has(String(a.tokenId)))
      .map((a) => ({ ...writtenById.get(a.tokenId), tokenId: a.tokenId, name: a.name, owner: a.owner ?? null, imageUrl: a.imageUrl ?? null, price: a.price ?? writtenById.get(a.tokenId)?.price ?? null }))
  // an unread shelf falls back to the written picks; a read one that offers nothing is believed
  if (!shelf) return written.filter((a) => !exclude.has(String(a.tokenId))).slice(0, 1)
  const confirmed = offer(shelf.confirmed)  return confirmed.slice(0, 1)
}

// the quest's standing in this browser: a wallet starts it or sets it aside, and anyone,
// connected or not, can turn the invitation down
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

// a quest is started by a wallet, never by a browser: with no wallet connected only a
// turned-down invitation is kept, so the next visitor on this browser is still invited
export function writeQuestMode(wallet: string | null, mode: QuestMode, now = Date.now()): void {
  try {
    if (wallet || mode === 'dismissed') store()?.setItem(keyFor('mode', wallet), mode)
    if (mode === 'dismissed') store()?.setItem(keyFor('dismissedAt', wallet), String(now))
  } catch {
    // a browser without storage simply asks again next visit
  }
  notifyQuest()
}

// "Not now" means not today: the invitation is back the next day
export const DISMISSAL_MS = 24 * 60 * 60 * 1000

function turnedDownToday(wallet: string | null, now: number): boolean {
  if (readQuestMode(wallet) !== 'dismissed') return false
  try {
    const at = Number(store()?.getItem(keyFor('dismissedAt', wallet)) ?? 0)
    return at > 0 && now - at < DISMISSAL_MS
  } catch {
    return false
  }
}

// what to show this visitor: the connected wallet's own standing, or else only whether the
// invitation was turned down here within the last day
export function questModeFor(wallet: string | null, now = Date.now()): QuestMode | null {
  const own = wallet ? readQuestMode(wallet) : null
  if (own === 'active' || own === 'quit') return own
  return (wallet && turnedDownToday(wallet, now)) || turnedDownToday(null, now) ? 'dismissed' : null
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
