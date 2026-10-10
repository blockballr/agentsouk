import type { Verification } from '@agora/core'

// one plain word per check result, shared by every page that shows one, so a card,
// the agent page and compare never describe the same verdict three ways

// chain 97 has no paid-hire verifier: its delivered verdicts come from the scout
// liveness probe, so they prove reachability rather than delivery
const BSC_TESTNET_CHAIN_ID = 97

export function isProbeCheck(chainId: number, quality?: { model: string }): boolean {
  if (quality?.model === 'deterministic') return true
  return chainId === BSC_TESTNET_CHAIN_ID && !quality
}

export type VerdictTone = 'good' | 'held' | 'bad' | 'none'

export interface Verdict {
  label: string
  tone: VerdictTone
  explain: string
}

export function verdictFor(
  chainId: number,
  v: Pick<Verification, 'status' | 'quality'> | null | undefined,
): Verdict {
  if (!v) {
    return { label: 'Not checked yet', tone: 'none', explain: 'The marketplace has not checked this agent yet.' }
  }
  if (v.status === 'delivered') {
    // a deterministic check costs nothing: the sweep asked a task with a knowable
    // answer and scored what came back, so a correct answer is evidence the work
    // happens without anyone paying a hire for it
    if (v.quality?.model === 'deterministic') {
      return v.quality.grade === 'good'
        ? {
            label: 'Proven',
            tone: 'good',
            explain:
              'It did a task whose answer we can check, and the answer was right. No hire was paid to find that out.',
          }
        : {
            label: 'Online',
            tone: 'good',
            explain:
              'It answered a task we can check, but the answer did not hold up, so only its reachability is proven.',
          }
    }
    return isProbeCheck(chainId, v.quality)
      ? { label: 'Online', tone: 'good', explain: 'Answered the marketplace on its last check.' }
      : { label: 'Delivered', tone: 'good', explain: 'Delivered a result on the marketplace\'s last paid test hire.' }
  }
  if (v.status === 'gated') {
    return {
      label: 'Restricted',
      tone: 'held',
      explain: 'Answers only through its own access gate or an ERC-8183 job, so a direct test hire cannot reach it.',
    }
  }
  if (v.status === 'unreachable') {
    return { label: 'Unreachable', tone: 'bad', explain: 'The last check found no endpoint it can call.' }
  }
  return { label: 'Unresponsive', tone: 'bad', explain: 'The last check got no usable answer.' }
}

// the dot beside a verdict; text stays in the body colour so it reads in both themes
export const VERDICT_DOT: Record<VerdictTone, string> = {
  good: 'glow bg-highlighter-green',
  held: 'bg-slate-verdant/60',
  bad: 'border hairline border-newsprint-gray bg-transparent',
  none: 'border hairline border-slate-verdant/50 bg-transparent',
}
