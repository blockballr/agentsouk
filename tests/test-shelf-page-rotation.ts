// The shelf top up used to read only the newest registry page, so a listing
// that arrived between pulls could fall past it and never be seen again. The
// rotation walks a fixed span of pages instead, one page per cooldown slot, so
// coverage completes in the span without more upstream calls. These pin the
// rotation itself: always page one or later, wrapping inside the span, and
// moving forward exactly once per cooldown.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { rotatingRefreshPage } from "@/lib/scanner";

const COOLDOWN = 60_000;
const SPAN = 40;

describe("shelf refresh page rotation", () => {
  it("starts at a real page and stays inside the span", () => {
    for (let slot = 0; slot < 200; slot += 1) {
      const page = rotatingRefreshPage(slot * COOLDOWN);
      expect(page).toBeGreaterThanOrEqual(1);
      expect(page).toBeLessThanOrEqual(SPAN);
    }
  });

  it("advances by one page per cooldown and wraps", () => {
    const base = 1_000 * COOLDOWN;
    const first = rotatingRefreshPage(base);
    const next = rotatingRefreshPage(base + COOLDOWN);
    const expected = first === SPAN ? 1 : first + 1;
    expect(next).toBe(expected);
  });

  it("is deterministic across instances reading the same clock", () => {
    const at = 12_345 * COOLDOWN + 17_000;
    expect(rotatingRefreshPage(at)).toBe(rotatingRefreshPage(at));
  });
});
