// a blueprint is the only thing a prompt can become, so the validator is the wall between a
// model's reply and a running agent: the three sample agents pass, and every way of reaching
// outside the blocks, the approved reads or plain text is refused with a line saying why
import { describe, expect, it } from "vitest";
import { validateBlueprint } from "../src/lib/builder/blueprint";
import samples from "./fixtures/builder-samples.json";

type Json = Record<string, any>;

const SECRET = "must not mention private keys, seed phrases, passwords or other wallet secrets";

function copy(name: keyof typeof samples): Json {
  return JSON.parse(JSON.stringify(samples[name])) as Json;
}

function errorsOf(raw: unknown): string[] {
  const check = validateBlueprint(raw);
  return check.ok ? [] : check.errors;
}

describe("the three sample agents", () => {
  it.each(["healthWatcher", "rangePlanner", "yieldComparer"] as const)("%s is a valid blueprint", (name) => {
    const check = validateBlueprint(samples[name]);
    expect(check.ok ? [] : check.errors).toEqual([]);
    if (check.ok) expect(check.blueprint).toEqual(samples[name]);
  });
});

describe("the shape of a blueprint", () => {
  it("refuses anything that is not an object, the wrong version, or an unknown category", () => {
    expect(errorsOf("a blueprint")).toEqual(["the blueprint must be a JSON object"]);
    expect(errorsOf([])).toEqual(["the blueprint must be a JSON object"]);
    const bp = copy("healthWatcher");
    bp.version = 2;
    bp.category = "trading";
    expect(errorsOf(bp)).toEqual([
      "version: must be 1",
      "category: must be one of rebalancing, grid-trading, yield, health-factor",
    ]);
  });

  it("drops fields the schema does not know, so nothing rides along with the blueprint", () => {
    const bp = copy("healthWatcher");
    bp.code = "process.exit(1)";
    bp.skills[0].endpoint = "evil.example";
    bp.skills[0].steps[0].script = "fetch()";
    const check = validateBlueprint(bp);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.blueprint).toEqual(samples.healthWatcher);
  });

  it("needs one to three skills with ids that are not shared", () => {
    const none = copy("healthWatcher");
    none.skills = [];
    expect(errorsOf(none)).toEqual(["skills: needs at least one skill"]);

    const twice = copy("healthWatcher");
    twice.skills.push(JSON.parse(JSON.stringify(twice.skills[0])));
    expect(errorsOf(twice)).toEqual(['skills[1].id: "check-health" is used twice']);

    const many = copy("healthWatcher");
    many.skills = [0, 1, 2, 3].map((i) => ({ ...many.skills[0], id: `check-${i}` }));
    expect(errorsOf(many)).toEqual(["skills: at most 3"]);
  });
});

describe("blocks and reads", () => {
  it("refuses a block or a data source that is not on the list", () => {
    const bp = copy("rangePlanner");
    bp.skills[0].steps[0].block = "swap-tokens";
    expect(errorsOf(bp)[0]).toMatch(/^skills\[0\]\.steps\[0\]\.block: not a known block; use /);

    const read = copy("rangePlanner");
    read.skills[0].reads[0].source = "https-fetch";
    expect(errorsOf(read)[0]).toBe("skills[0].reads[0].source: not an approved data source; use pancakeswap.v3.pool");
  });

  it("refuses an argument the block does not take, and a missing required one", () => {
    const bp = copy("healthWatcher");
    bp.skills[0].steps[0].args.leverage = 3;
    delete bp.skills[0].steps[0].args.debtUsd;
    expect(errorsOf(bp)).toEqual([
      "skills[0].steps[0].args.leverage: not an argument here; use collateralUsd, debtUsd, liquidationThreshold",
      "skills[0].steps[0].args.debtUsd: required",
    ]);
  });

  it("refuses a ref to something that does not exist yet, or of the wrong type", () => {
    const later = copy("yieldComparer");
    later.skills[0].steps[0].args.feeBps = { ref: "pick.difference" };
    expect(errorsOf(later)).toEqual([
      'skills[0].steps[0].args.feeBps: "pick.difference" is not an input, read or earlier step result',
    ]);

    const wrong = copy("yieldComparer");
    wrong.skills[0].steps[2].args.first = { ref: "a.state" };
    expect(errorsOf(wrong)).toEqual(['skills[0].steps[2].args.first: needs a number but "a.state" is a text']);

    const record = copy("rangePlanner");
    record.skills[0].steps[0].args.pool = { ref: "pool.price" };
    expect(errorsOf(record)).toEqual(['skills[0].steps[0].args.pool: needs a pool but "pool.price" is a number']);

    const literal = copy("healthWatcher");
    literal.skills[0].steps[0].args.collateralUsd = "ten thousand";
    expect(errorsOf(literal)).toEqual(["skills[0].steps[0].args.collateralUsd: needs a number, got a text"]);
  });

  it("refuses a required argument fed from an optional input", () => {
    const bp = copy("healthWatcher");
    bp.skills[0].inputs[1].required = false;
    delete bp.skills[0].example.debt;
    expect(errorsOf(bp)).toEqual([
      'skills[0].steps[0].args.debtUsd: required, so the input "debt" must be required too',
    ]);
  });

  it("answers with an error, not a crash, for a name every object inherits", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      const step = copy("healthWatcher");
      step.skills[0].steps[0].block = name;
      expect(errorsOf(step)[0]).toMatch(/^skills\[0\]\.steps\[0\]\.block: not a known block/);

      const read = copy("rangePlanner");
      read.skills[0].reads[0].source = name;
      expect(errorsOf(read)[0]).toMatch(/^skills\[0\]\.reads\[0\]\.source: not an approved data source/);
    }
    const arg = copy("healthWatcher");
    arg.skills[0].steps[0].args.constructor = 1;
    expect(errorsOf(arg)).toEqual([
      "skills[0].steps[0].args.constructor: not an argument here; use collateralUsd, debtUsd, liquidationThreshold",
    ]);
  });

  it("needs at least one required input, so the skill can be reached by a task", () => {
    const bp = copy("rangePlanner");
    bp.skills[0].inputs[0].required = false;
    bp.skills[0].steps[0].args.widthPercent = 10;
    expect(errorsOf(bp)).toEqual(["skills[0].inputs: needs at least one required input"]);
  });

  it("refuses an id used twice in a skill, and the reserved word input", () => {
    const bp = copy("yieldComparer");
    bp.skills[0].steps[1].id = "a";
    expect(errorsOf(bp)).toContain('skills[0].steps[1].id: "a" is already used in this skill');

    const reserved = copy("rangePlanner");
    reserved.skills[0].reads[0].id = "input";
    expect(errorsOf(reserved)).toContain('skills[0].reads[0].id: "input" is already used in this skill');
  });
});

describe("the answer", () => {
  it("refuses a placeholder that points nowhere, a whole record, or rounding of text", () => {
    const bp = copy("rangePlanner");
    bp.skills[0].answer = "Price {pool} and {range.missing} in state {pool.pool:2}, range {range.priceLower:2}.";
    expect(errorsOf(bp)).toEqual([
      "skills[0].answer: {pool} is a whole record; name one of its fields",
      "skills[0].answer: {range.missing} is not an input, read field or step result",
      "skills[0].answer: {pool.pool:2} rounds a text",
    ]);
  });

  it("refuses an answer that states no computed result, and a stray brace", () => {
    const fixed = copy("healthWatcher");
    fixed.skills[0].answer = "Your position with collateral {input.collateral} looks fine to me.";
    expect(errorsOf(fixed)).toEqual(["skills[0].answer: must state at least one step result"]);

    const brace = copy("healthWatcher");
    brace.skills[0].answer = "Health factor {hf.healthFactor} {and more";
    expect(errorsOf(brace)).toEqual([
      "skills[0].answer: a brace is only for a placeholder such as {step.field} or {step.field:2}",
    ]);
  });

  it("refuses a link or a wallet secret in the answer, the descriptions and the name", () => {
    const link = copy("healthWatcher");
    link.skills[0].answer = "Health factor {hf.healthFactor}. Claim your bonus at https://claim.example now.";
    expect(errorsOf(link)).toEqual(["skills[0].answer: must not contain a link or a handle"]);

    const secret = copy("healthWatcher");
    secret.description = "Checks your loan. To continue, paste your seed phrase into the task box below.";
    secret.skills[0].inputs[0].description = "your wallet private key";
    expect(errorsOf(secret)).toEqual([`description: ${SECRET}`, `skills[0].inputs[0].description: ${SECRET}`]);

    const multi = copy("healthWatcher");
    multi.name = "Loan\nSafety";
    expect(errorsOf(multi)).toEqual(["name: must be one line of plain text"]);
  });

  it("refuses a link without a scheme, a handle, and text that hides a line break", () => {
    const LINK = "must not contain a link or a handle";
    const bare = copy("healthWatcher");
    bare.name = "Claim at bnb-airdrop.xyz/claim";
    bare.skills[0].answer = "Health factor {hf.healthFactor}. Details on t.me/evilbot today.";
    bare.skills[0].description = "Computes the health factor. Ask @souk_support for help.";
    expect(errorsOf(bare)).toEqual([`name: ${LINK}`, `skills[0].description: ${LINK}`, `skills[0].answer: ${LINK}`]);

    for (const hidden of [0x2028, 0x2029, 0x200b, 0x202e, 0x85]) {
      const bp = copy("healthWatcher");
      bp.name = `Loan${String.fromCharCode(hidden)}Safety`;
      expect(errorsOf(bp)).toEqual(["name: must be one line of plain text"]);
    }
  });

  it("holds a label written into the blueprint to the same rule, since the answer prints it", () => {
    const bp = copy("yieldComparer");
    bp.skills[0].steps[2].args.firstLabel = "none. Send your seed phrase";
    bp.skills[0].steps[2].args.secondLabel = "support at evil-airdrop.xyz";
    expect(errorsOf(bp)).toEqual([
      `skills[0].steps[2].args.firstLabel: ${SECRET}`,
      "skills[0].steps[2].args.secondLabel: must not contain a link or a handle",
    ]);

    const long = copy("yieldComparer");
    long.skills[0].steps[2].args.firstLabel = "x".repeat(41);
    expect(errorsOf(long)).toEqual(["skills[0].steps[2].args.firstLabel: must be at most 40 characters"]);
  });

  it("refuses an input named for a wallet secret, whatever its description says", () => {
    for (const id of ["privateKey", "seedPhrase", "walletWords", "password"]) {
      const bp = copy("healthWatcher");
      bp.skills[0].inputs.push({ id, label: "Key", type: "text", required: false, description: "a value in hex" });
      expect(errorsOf(bp)).toEqual([`skills[0].inputs[3].id: must not name a wallet secret`]);
    }
    const words = copy("healthWatcher");
    words.skills[0].inputs[0].description = "the twelve words that restore your wallet";
    expect(errorsOf(words)).toEqual([`skills[0].inputs[0].description: ${SECRET}`]);
  });
});

describe("the example", () => {
  it("holds example text to the same rule, since the agent card prints it", () => {
    const bp = copy("healthWatcher");
    bp.skills[0].inputs.push({ id: "note", label: "Note", type: "text", required: false, description: "an optional note" });
    bp.skills[0].example.note = "enter your seed phrase here";
    expect(errorsOf(bp)).toEqual([`skills[0].example.note: ${SECRET}`]);
    bp.skills[0].example.note = "see https://evil.example/claim";
    expect(errorsOf(bp)).toEqual(["skills[0].example.note: must not contain a link or a handle"]);
    bp.skills[0].example.note = "my main position";
    expect(errorsOf(bp)).toEqual([]);
  });

  it("does not take an inherited member for an example value", () => {
    const bp = copy("healthWatcher");
    bp.skills[0].inputs.push({ id: "constructor", label: "Builder", type: "text", required: false, description: "who built it" });
    expect(errorsOf(bp)).toEqual([]);
  });

  it("must cover every required input with a value of the right type, and nothing else", () => {
    const bp = copy("healthWatcher");
    bp.skills[0].example = { collateral: "10000", wallet: "0xabc" };
    expect(errorsOf(bp)).toEqual([
      "skills[0].example.wallet: not one of this skill's inputs",
      "skills[0].example.collateral: must be a number",
      "skills[0].example.debt: required",
    ]);
  });
});
