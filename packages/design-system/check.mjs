import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

function hex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const tokensCss = await readFile(resolve(root, "src", "tokens.css"), "utf8");
const tokens = {};
for (const match of tokensCss.matchAll(/--ds-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) {
  tokens[match[1]] = hex(match[2]);
}

const pairs = [
  ["ink", "canvas", 4.5, "body text"],
  ["ink-dim", "canvas", 4.5, "secondary text"],
  ["ink-faint", "canvas", 4.5, "faint labels"],
  // The accent text is the brand fill itself, used for links, labels and
  // highlights so they read as the same violet as the button. It is chrome,
  // not body copy, so it is held to the large-text floor rather than 4.5.
  ["accent-text", "canvas", 3, "accent text"],
  ["on-accent", "accent", 4.5, "primary button label"],
  ["good", "canvas", 4.5, "live and good"],
  ["warn", "canvas", 4.5, "warn"],
  ["bad", "canvas", 4.5, "error and exit"],
  ["focus", "canvas", 3, "focus ring"],
];

let failed = false;
const rows = [];
for (const [fg, bg, floor, use] of pairs) {
  if (!tokens[fg] || !tokens[bg]) {
    rows.push([use, fg + " on " + bg, "missing", floor.toFixed(1), "fail"]);
    failed = true;
    continue;
  }
  const ratio = contrast(tokens[fg], tokens[bg]);
  const pass = ratio >= floor;
  if (!pass) failed = true;
  rows.push([use, fg + " on " + bg, ratio.toFixed(2) + ":1", floor.toFixed(1) + ":1", pass ? "pass" : "FAIL"]);
}

const widths = [16, 30, 10, 8, 6];
const headers = ["use", "pair", "ratio", "floor", ""];
const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join(" ");
console.log(line(headers));
console.log(line(widths.map((width) => "-".repeat(width))));
for (const row of rows) console.log(line(row));

// The gallery is deployed from apps/agents, so it carries a generated copy of
// the system. A stale copy is a failure, not a warning.
const banner = "/* Midnight design system. Generated from packages/design-system/src. Do not edit by hand. */\n\n";
const parts = ["tokens.css", "base.css", "components.css"];
const sources = await Promise.all(parts.map((part) => readFile(resolve(root, "src", part), "utf8")));
const expected = banner + sources.join("\n");
const copies = [
  resolve(root, "dist/midnight.css"),
  resolve(root, "../../apps/agents/system.css"),
];
for (const copy of copies) {
  const actual = await readFile(copy, "utf8").catch(() => null);
  const name = copy.split(/[\\/]/).slice(-2).join("/");
  if (actual !== expected) {
    console.error("stale copy: " + name + " (run node packages/design-system/build.mjs)");
    failed = true;
  } else {
    console.log("in sync: " + name);
  }
}

if (failed) process.exit(1);
console.log("midnight: contrast and generated copies pass");
