import "server-only";
import { CATEGORY_KEYS } from "@agora/core";
import { durableMode, loadJobsByToken } from "./durable-store";
import { asksForSecrets, hasConfirmedCompletion } from "./quest-eligibility";
import { queryAgents } from "./scanner";
import { isVerifierPayment } from "./team-wallets";
import { targetChainId } from "./types";
import { loadVerifications } from "./verifications";

export interface QuestShelfAgent {
  tokenId: string;
  name: string;
  owner: string;
}

// what a quest step may offer in one category, both in the order the shelf rotated them for
// this visit: agents with a confirmed completed job, and every agent that answered its last check
export interface QuestShelf {
  confirmed: QuestShelfAgent[];
  working: QuestShelfAgent[];
}

const EVIDENCE_MS = 60_000;
const evidence = new Map<string, { at: number; ok: boolean }>();

async function confirmed(chainId: number, tokenId: string, owner: string): Promise<boolean> {
  const key = `${chainId}:${tokenId}`;
  const hit = evidence.get(key);
  if (hit && Date.now() - hit.at < EVIDENCE_MS) return hit.ok;
  const jobs = await loadJobsByToken(chainId, tokenId);
  const ok = hasConfirmedCompletion(jobs, owner, isVerifierPayment);
  evidence.set(key, { at: Date.now(), ok });
  return ok;
}

// the picks follow the shelf, so an agent listed tomorrow is offered as soon as it answers its
// check and a job has completed on it; nothing here names an agent
export async function loadQuestShelf(
  seed: string | null,
): Promise<{ chainId: number; observed: boolean; picks: Record<string, QuestShelf> }> {
  const chainId = targetChainId();
  const observed = durableMode() === "postgres";
  const verifications = await loadVerifications();
  const shelf = await queryAgents({ limit: 5000, sort: "reachability", verifications, seed });
  const picks: Record<string, QuestShelf> = {};
  for (const category of CATEGORY_KEYS) {
    const working = shelf.items.filter((a) => {
      const check = verifications.get(a.token_id);
      return a.category === category && check?.status === "delivered" && !asksForSecrets(check.detail);
    });
    const proven: typeof working = [];
    // without the durable store no job can be read back, so nothing is claimed as confirmed
    if (observed) {
      for (const a of working.slice(0, 12)) {
        if (await confirmed(chainId, a.token_id, a.owner_address)) proven.push(a);
      }
    }
    const shape = (a: (typeof working)[number]): QuestShelfAgent => ({
      tokenId: a.token_id,
      name: a.name,
      owner: a.owner_address,
    });
    picks[category] = { confirmed: proven.slice(0, 3).map(shape), working: working.slice(0, 12).map(shape) };
  }
  return { chainId, observed, picks };
}
