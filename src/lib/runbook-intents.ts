// The intents a runbook can answer. Kept apart from the builder so the tool
// schema and the manifest can name them without importing the builder.

export const RUNBOOK_INTENTS = ["browse", "hire", "jobs", "vault", "publish"] as const;
export type RunbookIntent = (typeof RUNBOOK_INTENTS)[number];

export function isRunbookIntent(value: unknown): value is RunbookIntent {
  return typeof value === "string" && (RUNBOOK_INTENTS as readonly string[]).includes(value);
}
