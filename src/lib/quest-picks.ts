import "server-only";
import { CATEGORY_KEYS, classifyExecution, takesJobs } from "@agora/core";
import { durableMode, loadJobsByToken } from "./durable-store";
import { asksForSecrets, hasConfirmedCompletion } from "./quest-eligibility";
import { answeringPick, declaredPrice } from "./quest-pick-health";
import { queryAgents } from "./scanner";
import { isVerifierPayment } from "./team-wallets";
import { targetChainId } from "./types";
import { loadVerifications } from "./verifications";

export interface QuestShelfAgent {
  tokenId: string;
  name: string;
  owner: string;
  imageUrl?: string | null;
  // what the seller declares it charges, verbatim, or null when the price only
  // exists as a signed quote. never a number this server invented
  price?: string | null;
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
  // no sort named: the default order is job capability, then the metric chain,
  // with reachability settling the ties. The filter below wants delivered
  // listings only and re-sorts by job capability anyway, so what matters here
  // is that the whole shelf is in hand.
  const shelf = await queryAgents({ limit: 5000, verifications, seed });
  // the hire task serves agents whose own registration claims an action, because the
  // campaign discounts agents that respond but never execute; the probe verdict alone
  // cannot tell the two apart, since a delivered read looks the same from both
  const executionText = (a: (typeof shelf.items)[number]): string =>
    [a.name, a.description, ...(a.skills ?? []).map((s) => `${s.name} ${s.description ?? ""}`)].join(" ");
  const picks: Record<string, QuestShelf> = {};
  for (const category of CATEGORY_KEYS) {
    // only job-capable (escrow) agents that answered their last check. A category with
    // none stays empty, so the quest never sends a buyer to a direct-only, x402-only or
    // unreachable agent, and never to one that has to answer a quote request it ignores
    const working = shelf.items
      .filter((a) => {
        // the sweep's own row first, then the verdict the catalogue row carries, so a
        // cold or empty store does not read as "every listing is dead"
        const check = verifications.get(a.token_id) ?? a.verification;
        const detail = check && "detail" in check ? (check as { detail?: string }).detail : undefined;
        return (
          a.category === category &&
          takesJobs(a.skills) &&
          answeringPick(check) &&
          (!detail || !asksForSecrets(detail)) &&
          classifyExecution(executionText(a)).executes
        );
      })
      .sort((a, b) => (takesJobs(b.skills) ? 1 : 0) - (takesJobs(a.skills) ? 1 : 0));
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
      imageUrl: a.image_url,
      price: declaredPrice(a.skills),
    });
    picks[category] = { confirmed: proven.slice(0, 3).map(shape), working: working.slice(0, 12).map(shape) };
  }
  return { chainId, observed, picks };
}
