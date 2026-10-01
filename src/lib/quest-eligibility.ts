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

// an agent whose reply asks for a wallet's secret is never sent visitors, however its check
// was recorded
const SECRET_REQUEST = /private[\s_-]?key|seed[\s_-]?phrase|recovery[\s_-]?phrase|mnemonic|secret[\s_-]?key|keystore/i;

export function asksForSecrets(reply: string | null | undefined): boolean {
  return Boolean(reply && SECRET_REQUEST.test(reply));
}
