// Resolving the settlement mode in one place, with no imports, so it can be
// tested directly and so the settle route cannot drift into a silent fallback.

export type FacilitatorMode = "prod" | "b402" | "sandbox";

const MODES: readonly FacilitatorMode[] = ["prod", "b402", "sandbox"];

export function isFacilitatorMode(value: string): value is FacilitatorMode {
  return (MODES as readonly string[]).includes(value);
}

// Resolve FACILITATOR_MODE to a known mode: unset or empty means sandbox, and a
// value that is set but unrecognised throws rather than silently moving no funds.
export function resolveFacilitatorMode(raw: string | undefined | null): FacilitatorMode {
  const value = (raw ?? "").trim().toLowerCase();

  if (value === "") return "sandbox";
  if (isFacilitatorMode(value)) return value;

  throw new Error(
    `FACILITATOR_MODE is set to ${JSON.stringify(raw)} but must be one of: ${MODES.join(", ")}. ` +
      "Refusing to fall back to sandbox, because sandbox settlements do not move funds on chain.",
  );
}
