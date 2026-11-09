export type ButtonVariant = "primary" | "secondary" | "quiet" | "caution";
export type ButtonSize = "sm" | "md";
export type CardTone = "plain" | "active";
export type CardPad = "sm" | "md" | "lg";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// One primary per decision. Every other action is secondary or quiet.
export function button(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  const tone =
    variant === "primary"
      ? "ds-btn--primary"
      : variant === "caution"
        ? "ds-btn--caution"
        : variant === "quiet"
          ? "ds-btn--quiet"
          : false;
  return cx("ds-btn", tone, size === "sm" && "ds-btn--sm");
}

export function card(tone: CardTone = "plain", pad: CardPad = "md"): string {
  return cx(
    "ds-card",
    tone === "active" && "ds-card--active",
    pad === "sm" && "ds-card--sm",
    pad === "lg" && "ds-card--lg"
  );
}

export const label = "ds-label";
export const mono = "ds-mono";
export const muted = "ds-muted";
export const eyebrow = "ds-eyebrow";
export const display = "ds-display";
export const lede = "ds-lede";
export const notice = "ds-notice";
export const chip = "ds-chip";
export const field = "ds-field";
export const input = "ds-input";
export const facts = "ds-facts";
export const fact = "ds-fact";
export const metrics = "ds-metrics";
export const metric = "ds-metric";
export const table = "ds-table";
export const panel = "ds-panel";
export const hero = "ds-hero";
export const steps = "ds-steps";
export const step = "ds-step";
export const tabs = "ds-tabs";
export const tab = "ds-tab";
export const skeleton = "ds-skeleton";
export const empty = "ds-empty";
export const dialog = "ds-dialog";
