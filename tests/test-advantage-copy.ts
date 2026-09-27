// The Advantage captures were measured on the sandbox rail on 2026-09-08, while
// the deployment now settles sUSD on chain 97. A reader must be able to tell the
// dated capture from current evidence, so the lead sentence states the rail and
// spells the age out instead of only printing a timestamp.
import { describe, expect, it } from "vitest";
import { captureAgeWords, captureLead } from "../apps/web/src/pages/AdvantagePage";

const NOW = new Date("2026-09-27T00:00:00.000Z");

describe("advantage capture age", () => {
  it("spells the age of the shipped capture in words", () => {
    const age = captureAgeWords("2026-09-08T04:24:00.474Z", NOW);
    expect(age).toBe("about three weeks");
  });

  it("grows honest wording as the capture ages", () => {
    expect(captureAgeWords("2026-09-27T00:00:00.000Z", NOW)).toBe("less than a day");
    expect(captureAgeWords("2026-09-26T00:00:00.000Z", NOW)).toBe("one day");
    expect(captureAgeWords("2026-09-17T00:00:00.000Z", NOW)).toBe("ten days");
    expect(captureAgeWords("2026-06-01T00:00:00.000Z", NOW)).toBe("about four months");
    expect(captureAgeWords("2024-09-27T00:00:00.000Z", NOW)).toBe("about two years");
  });

  it("refuses to invent an age it cannot know", () => {
    expect(captureAgeWords(undefined, NOW)).toBeNull();
    expect(captureAgeWords("not a date", NOW)).toBeNull();
    expect(captureAgeWords("2026-09-28T00:00:00.000Z", NOW)).toBeNull();
  });
});

describe("advantage capture lead", () => {
  it("names the sandbox rail and denies moved funds", () => {
    const lead = captureLead("2026-09-08T04:24:00.474Z", NOW);
    expect(lead).toContain("sandbox rail");
    expect(lead).toContain("no funds moved");
    expect(lead).toContain("about three weeks old");
  });

  it("never claims funds moved", () => {
    const lead = captureLead("2026-09-08T04:24:00.474Z", NOW);
    expect(lead).not.toMatch(/settled|on chain|moved funds/i);
  });
});
