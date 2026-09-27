#!/usr/bin/env node
// Fails on mojibake in tracked text files.
//
// Mojibake is UTF-8 read as cp1252 and written back. It once grew a single
// tracked file to 8 MB of noise, so it is checked in CI rather than only by the
// local pre-commit gate, which a direct commit can bypass.
//
// The sequences are matched rather than any non-ascii, because the interface
// legitimately uses a middle dot, an arrow and an ellipsis, and the registry
// snapshot legitimately carries agent text that is not english.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const textExt = /\.(ts|tsx|js|mjs|cjs|json|md|txt|css|html|yml|yaml|toml|py|rs|sh|ps1|sol)$/i;
const skip = /(^|\/)(node_modules|\.next|dist|build|out|vendor|\.vercel|\.wrangler)(\/|$)/;
const dataDir = /^data\//;

const patterns = [
  ["a-tilde pair", /\u00c3[\u0080-\u00bf]/g],
  ["a-circumflex pair", /\u00c2[\u0080-\u00bf]/g],
  ["euro sequence", /\u00e2\u20ac/g],
  ["e-thorn pair", /\u00f0\u0178/g],
];

const tracked = sh("git ls-files").split("\n").map((s) => s.trim()).filter(Boolean);
const problems = [];

for (const f of tracked) {
  if (!textExt.test(f) || skip.test(f) || !existsSync(f)) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const [name, re] of patterns) {
    const n = (text.match(re) || []).length;
    if (n > 0) problems.push(`${n} ${name} sequence(s) in ${f}`);
  }
  const lost = (text.match(/\ufffd/g) || []).length;
  if (lost > 0 && !dataDir.test(f)) {
    problems.push(`${lost} replacement character(s) in ${f}, so bytes were lost`);
  }

  // Control characters other than tab, LF and CR. A 0x07 byte standing where a
  // letter should be is what made a committed README render as "project ?gora",
  // and an above-127 scan cannot see it because 0x07 is valid ascii.
  let control = 0;
  for (const ch of text) {
    const n = ch.codePointAt(0);
    if ((n < 32 && n !== 9 && n !== 10 && n !== 13) || n === 127) control += 1;
  }
  if (control > 0) {
    problems.push(`${control} control character(s) in ${f}, which corrupt the rendered text`);
  }
}

if (problems.length > 0) {
  console.error("mojibake check failed:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`mojibake check passed (${tracked.length} tracked files)`);
