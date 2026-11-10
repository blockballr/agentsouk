// Availability is one fact assembled from four sources: the last verification
// verdict, its quotable flag, the shelf admission and the owner delist. The app
// has carried several vocabularies for the same idea; this names one state and
// says whether a hire can execute and whether the listing belongs on the shelf.

export type AvailabilityPhase =
  | "unknown"
  | "live"
  | "gated"
  | "failing"
  | "delisted"
  | "dead"
  | "unreachable"
  | "unresponsive"
  | "restricted"
  | "not-checked";

export interface AvailabilityInput {
  /** the verification row's status; online and delivered are the same verdict */
  status: string | null;
  /** null means the check did not decide; false keeps it off the shelf */
  quotable: boolean | null;
  /** ISO time the failure clock started, when one is running */
  failingSince: string | null;
  /** an owner or automatic delist */
  delisted: boolean;
  /** the shelf holds an admission for this listing */
  admitted: boolean;
  /** the listing publishes a callable a2a or mcp endpoint */
  canExecute: boolean;
  /** the shelf category; general and empty do not count */
  category: string | null;
  /** the card declares its own access scheme, which the marketplace cannot satisfy */
  accessGated?: boolean;
  /** milliseconds */
  now?: number;
}

export interface AvailabilityView {
  phase: AvailabilityPhase;
  shelf: boolean;
  hireable: boolean;
  quotable: boolean;
  failingSince: string | null;
  failingDays: number | null;
  reason: string;
}

function normalized(status: string | null): AvailabilityPhase {
  if (!status) return "not-checked";
  const value = status.trim().toLowerCase();
  if (value === "online" || value === "delivered") return "live";
  if (value === "gated") return "gated";
  if (value === "dead") return "dead";
  if (value === "unreachable") return "unreachable";
  if (value === "unresponsive") return "unresponsive";
  if (value === "restricted") return "restricted";
  if (value === "not_checked" || value === "not-checked") return "not-checked";
  return "unknown";
}

// an agent that answered behind its own gate is alive and may still be hired,
// so only a verdict that says "no answer" runs the failure clock
function countsAsFailing(status: AvailabilityPhase): boolean {
  return status !== "live" && status !== "gated";
}

export function deriveAvailability(input: AvailabilityInput): AvailabilityView {
  const now = input.now ?? Date.now();
  const verdict = normalized(input.status);
  const failingSince = input.failingSince;
  const failingAt = failingSince ? Date.parse(failingSince) : Number.NaN;
  const counts = countsAsFailing(verdict);
  const failingDays =
    counts && Number.isFinite(failingAt) ? Math.max(0, Math.floor((now - failingAt) / 86_400_000)) : null;

  const classified = Boolean(input.category && input.category.trim() && input.category !== "general");
  const quotable = input.quotable !== false;
  const admitted = input.admitted;
  const accessGated = input.accessGated === true;
  const onShelf = admitted && input.canExecute && quotable && classified;

  let phase: AvailabilityPhase;
  if (input.delisted) phase = "delisted";
  else if (accessGated || verdict === "gated") phase = "gated";
  else if (counts && failingSince) phase = "failing";
  else phase = verdict;

  // a gated listing stays on the shelf as a labelled listing, but the
  // marketplace holds none of the seller's credentials, so it does not sell a
  // call or job that would stop at that wall
  const hireable = !input.delisted && onShelf && phase === "live";

  let reason: string;
  if (phase === "delisted") {
    reason = "Delisted. The listing is off the shelf until it is relisted.";
  } else if (phase === "failing") {
    reason = failingDays === null
      ? "The endpoint is failing and the delist clock is running."
      : `The endpoint has been failing for ${failingDays} day${failingDays === 1 ? "" : "s"}.`;
  } else if (phase === "live") {
    reason = hireable ? "Live and hireable." : onShelf ? "Live, but the shelf admission is missing." : "Live, but not shelf-ready.";
  } else if (phase === "gated") {
    reason = onShelf
      ? "Behind its access gate. The marketplace holds no credentials, so it is reached at its endpoint, not hired here."
      : "Behind its access gate, and not shelf-ready.";
  } else if (phase === "not-checked") {
    reason = "Not checked yet.";
  } else if (phase === "unknown") {
    reason = `The verdict "${input.status ?? ""}" is not in a known vocabulary.`;
  } else {
    reason = "No callable answer. It is not hireable.";
  }

  return {
    phase,
    shelf: onShelf && (phase === "live" || phase === "gated"),
    hireable,
    quotable,
    failingSince,
    failingDays,
    reason,
  };
}
