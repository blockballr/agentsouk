// A deploy script that passes a different number of constructor arguments than
// the contract takes only fails at the moment someone deploys. Both vault
// scripts sat one argument short for weeks, so this fails the build instead.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function constructorArity(contract: string): number | null {
  const source = readFileSync(join(root, "contracts", "src", `${contract}.sol`), "utf8");
  const match = /\bconstructor\s*\(([^)]*)\)/.exec(source);
  if (!match) return null;
  const params = match[1].trim();
  return params === "" ? 0 : params.split(",").length;
}

// top-level commas inside the args array, so a nested call or array counts once
function argCount(list: string): number {
  if (list.trim() === "") return 0;
  let depth = 0;
  let count = 1;
  for (const ch of list) {
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) count += 1;
  }
  return list.trim().endsWith(",") ? count - 1 : count;
}

const scripts = readdirSync(join(root, "scripts"))
  .filter((name) => /^deploy-.*\.mjs$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(root, "scripts", name), "utf8") }))
  .map(({ name, text }) => ({
    name,
    contract: /contracts\/out\/(\w+)\.sol\//.exec(text)?.[1] ?? null,
    args: /deployContract\(\{[\s\S]*?args:\s*\[([\s\S]*?)\]\s*,?\s*\}\)/.exec(text)?.[1] ?? null,
  }))
  .filter((script) => script.contract !== null && script.args !== null);

describe("deploy scripts match the contracts they deploy", () => {
  it("finds the deploy scripts it is meant to guard", () => {
    expect(scripts.map((s) => s.name)).toEqual(expect.arrayContaining(["deploy-hirevault.mjs", "deploy-hirevault-v2.mjs"]));
  });

  for (const script of scripts) {
    it(`${script.name} passes ${script.contract}'s constructor every argument`, () => {
      expect(argCount(script.args!)).toBe(constructorArity(script.contract!));
    });
  }
});
