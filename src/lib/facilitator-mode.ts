// Resolving the settlement mode in one place, with no imports, so it can be
// tested directly and so the settle route cannot drift into a silent fallback.

export type FacilitatorMode = "prod" | "b402" | "sandbox";

const MODES: readonly FacilitatorMode[] = ["prod", "b402", "sandbox"];

export function isFacilitatorMode(value: string): value is FacilitatorMode {
  return (MODES as readonly string[]).includes(value);
}

/**
 * Resolve FACILITATOR_MODE to a known mode.
 *
 * Unset, empty, or whitespace means sandbox, which is the right default for a
 * developer machine.
 *
 * A value that is set but not recognised is thrown rather than treated as
 * sandbox. That distinction matters: sandbox settles nothing on chain and
 * returns a synthetic transaction hash, so a typo like "production" or "prod "
 * would otherwise ship a marketplace that appears to take payment and moves no
 * funds. Note that `??` does not catch an empty string, which is why this
 * trims explicitly instead of relying on a nullish default.
 */
export function resolveFacilitatorMode(raw: string | undefined | null): FacilitatorMode {
  const value = (raw ?? "").trim().toLowerCase();

  if (value === "") return "sandbox";
  if (isFacilitatorMode(value)) return value;

  throw new Error(
    `FACILITATOR_MODE is set to ${JSON.stringify(raw)} but must be one of: ${MODES.join(", ")}. ` +
      "Refusing to fall back to sandbox, because sandbox settlements do not move funds on chain.",
  );
}
