// the passport card's words: what the foot of the identity page reads, the date, the short
// holder, and the links that carry the caption. The drawing itself needs a browser, so it is
// checked there; these are the parts that can be wrong without looking wrong
import { describe, expect, it } from "vitest";
import { SHARE_CAPTION, SHARE_URL, SPECIMEN_SERIAL, issuedLabel, machineLines, portraitTiles, shareLinks, shortHolder, stampPlaces } from "../apps/web/src/lib/share-card";

const HOLDER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const ISSUED = new Date("2026-10-01T15:30:00Z");
const CARD = { rank: "Master of the Souk", points: 1000, holder: HOLDER as string | null, issued: ISSUED, seed: HOLDER, serial: null as string | null };

describe("the machine-readable lines", () => {
  it("are two lines of forty characters, padded with chevrons as a passport's are", () => {
    const [first, second] = machineLines(CARD);
    expect(first).toBe("P<SOUK<MASTER<OF<THE<SOUK<<<<<<<<<<<<<<<");
    expect(second).toBe("4BB3XXXX<<1000PTS<<5OF5<<261001<<BNB<<<<");
    expect(first).toHaveLength(40);
    expect(second).toHaveLength(40);
  });

  it("show how the address starts and never how it ends", () => {
    const [, second] = machineLines(CARD);
    expect(second).not.toContain("C862");
  });

  it("carry the passport's number in place of the date once one is issued", () => {
    expect(machineLines({ ...CARD, serial: "0110001" })[1]).toBe("4BB3XXXX<<1000PTS<<5OF5<<0110001<<BNB<<<");
    expect(machineLines({ ...CARD, serial: SPECIMEN_SERIAL })[1]).toBe("4BB3XXXX<<1000PTS<<5OF5<<0110000<<BNB<<<");
    expect(machineLines({ ...CARD, serial: "13111000" })[1]).toHaveLength(40);
  });

  it("carry no part of the address when the holder is left off the card", () => {
    const [, second] = machineLines({ ...CARD, holder: null });
    expect(second.startsWith("HOLDER<<1000PTS")).toBe(true);
    expect(second).not.toMatch(/4BB3|C862/);
  });

  it("never run past the page, whatever the title", () => {
    const [first] = machineLines({ ...CARD, rank: "Grand keeper of every market stall there is" });
    expect(first).toHaveLength(40);
    expect(first).toMatch(/^[A-Z0-9<]+$/);
  });
});

describe("the small print", () => {
  it("writes the issue date the way a passport does, in UTC", () => {
    expect(issuedLabel(ISSUED)).toBe("01 OCT 2026");
    expect(issuedLabel(new Date("2026-12-31T23:59:59Z"))).toBe("31 DEC 2026");
  });

  it("shortens the holder to its start, with the last four masked", () => {
    expect(shortHolder(HOLDER)).toBe("0x4bb3...xxxx");
  });
});

describe("the portrait", () => {
  const greens = (tiles: (string | null)[][]) => tiles.flatMap((row, r) => row.flatMap((t, c) => (t === "green" ? [[r, c]] : [])));

  it("is the same pattern for the same address, mirrored left to right", () => {
    const tiles = portraitTiles(HOLDER);
    expect(tiles).toEqual(portraitTiles(HOLDER.toUpperCase().replace("0X", "0x")));
    expect(tiles).toHaveLength(6);
    for (const row of tiles) expect([...row].reverse()).toEqual(row);
  });

  it("carries exactly one green tile, where the lowest black tile of the middle column was", () => {
    expect(greens(portraitTiles(HOLDER))).toEqual([[4, 2]]);
  });

  it("still carries its one green tile, at the foot, when the middle column has no black", () => {
    // every sampled digit is 1, so every tile is sage
    expect(greens(portraitTiles("0x" + "1".repeat(40)))).toEqual([[5, 2]]);
  });
});

describe("where the stamps land", () => {
  const OTHER = "0x06f757064043e57dbbccd6d95ee1113d9796c715";

  it("is the same for the same wallet and different for another", () => {
    expect(stampPlaces(HOLDER)).toEqual(stampPlaces(HOLDER));
    expect(stampPlaces(HOLDER)).not.toEqual(stampPlaces(OTHER));
  });

  it("keeps all five visas and the seal on the visa page, whatever the wallet", () => {
    for (let i = 0; i < 200; i++) {
      const { visas, seal } = stampPlaces(`0x${i.toString(16).padStart(40, "0")}`);
      expect(visas).toHaveLength(5);
      expect(new Set(visas.map((v) => `${v.x}:${v.y}`)).size).toBe(5);
      for (const v of visas) {
        // a visa is 156 by 68, so its middle stays this far inside the page's edges
        expect(v.x).toBeGreaterThanOrEqual(710);
        expect(v.x).toBeLessThanOrEqual(1070);
        expect(v.y).toBeGreaterThanOrEqual(155);
        expect(v.y).toBeLessThanOrEqual(510);
      }
      // one or two at a real slant, the rest only a little crooked
      const slanted = visas.filter((v) => Math.abs(v.tilt) > 9);
      expect(slanted.length).toBeGreaterThanOrEqual(1);
      expect(slanted.length).toBeLessThanOrEqual(2);
      for (const v of slanted) {
        expect(Math.abs(v.tilt)).toBeGreaterThanOrEqual(24);
        expect(Math.abs(v.tilt)).toBeLessThanOrEqual(38);
        // a slanted visa stands taller, so it only lands where the page has room for it
        expect(v.y).toBeGreaterThanOrEqual(286);
        expect(v.y).toBeLessThanOrEqual(418);
      }
      // the seal is 92 across each way, with the line under it still above the page's foot
      expect(seal.x).toBeGreaterThanOrEqual(968);
      expect(seal.x + 92).toBeLessThanOrEqual(1136);
      expect(seal.y + 122).toBeLessThanOrEqual(580);
    }
  });
});

describe("the share links", () => {
  it("carry the caption and the passport address to X", () => {
    const xUrl = new URL(shareLinks().x);
    expect(xUrl.origin + xUrl.pathname).toBe("https://x.com/intent/post");
    expect(xUrl.searchParams.get("text")).toBe(SHARE_CAPTION);
    expect(xUrl.searchParams.get("url")).toBe(SHARE_URL);
  });

  it("open the cards topic in Agent Souk's Telegram", () => {
    expect(shareLinks().telegram).toBe("https://t.me/agentsouk/106");
  });
});
