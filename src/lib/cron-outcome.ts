// A cron line used to be a boolean plus free text. That cannot separate a job
// that failed from one that was never configured, and the staleness panel read
// both as the same thing. The outcome names the four cases the routes actually
// produce, while `ok` stays for older readers.

export type CronOutcome = "ok" | "failed" | "skipped" | "not-configured" | "unauthorized";

export function cronOutcomeForStatus(status: number): CronOutcome {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 503) return "not-configured";
  return status < 400 ? "ok" : "failed";
}
