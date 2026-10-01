// whether an agent has been hired and finished end to end, which is what earns it a place in
// the quest's picks: a completed, paid job whose deliverable the marketplace itself recorded
// after running the task, that is not one of the verifier's probes and not the owner hiring
// its own agent. A team wallet's hire counts, because the question is whether a job completes
// on this agent, not who the buyer was

export interface CompletionEvidence {
  status: string;
  client: string;
  provider: string;
  paymentId?: string;
  history?: readonly { status: string; by: string }[];
}

export function hasConfirmedCompletion(
  jobs: readonly CompletionEvidence[],
  owner: string | null | undefined,
  isProbe: (paymentId: string) => boolean,
): boolean {
  const self = owner?.toLowerCase() ?? null;
  return jobs.some((j) => {
    if (j.status !== "Completed" || !j.paymentId || isProbe(j.paymentId)) return false;
    // a provider can record a deliverable by hand; only the marketplace's own relay shows the
    // agent answered a task
    if (!j.history?.some((e) => e.status === "Submitted" && e.by === "marketplace")) return false;
    const client = j.client.toLowerCase();
    return client !== self && client !== j.provider.toLowerCase();
  });
}

// one list of the words for a wallet's secret, read two ways below
const SECRET_TERMS = [
  "private[\\s_-]?key",
  "seed[\\s_-]?(?:phrase|words)",
  "recovery[\\s_-]?(?:phrase|words|key)",
  "mnemonic",
  "secret[\\s_-]?key",
  "keystore",
  "pass[\\s_-]?phrase",
  "password",
  "wallet[\\s_-]?(?:words|secret)",
  "(?:12|24|twelve|twenty[\\s-]?four)[\\s-]words",
].join("|");
const SECRET_MENTION = new RegExp(SECRET_TERMS, "i");

// an agent whose reply so much as names a wallet's secret is never sent visitors, however
// its check was recorded
export function asksForSecrets(reply: string | null | undefined): boolean {
  return Boolean(reply && SECRET_MENTION.test(reply));
}

const RULED_OUT = /\b(?:never|not|no|none|without|cannot|can't|don't|doesn't|won't)\b/i;
const SET_TO_NOTHING = /^["']?\s*[:=]\s*(?:false|null|0|"?(?:no|none|never)"?)(?![\w.])/i;
const SENTENCE_END = /[.!?\n]/g;

// the stricter reading, for anything that penalises an agent: the secret is named and not
// ruled out in the same sentence. "I never ask for a private key" is a promise, not a request
export function requestsWalletSecret(reply: string | null | undefined): boolean {
  if (!reply) return false;
  for (const match of reply.matchAll(new RegExp(SECRET_TERMS, "gi"))) {
    const at = match.index ?? 0;
    const before = reply.slice(Math.max(0, at - 160), at);
    let sentenceStart = 0;
    for (const end of before.matchAll(SENTENCE_END)) sentenceStart = (end.index ?? 0) + 1;
    if (RULED_OUT.test(before.slice(sentenceStart))) continue;
    if (SET_TO_NOTHING.test(reply.slice(at + match[0].length, at + match[0].length + 24))) continue;
    return true;
  }
  return false;
}
