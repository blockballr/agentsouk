// runs one skill of a blueprint: takes the caller's inputs, makes the approved reads, runs
// the blocks in order and words the answer. Every figure comes from a block, so the same
// inputs and the same reads always give the same answer

import { getBlock, getSource, own, type Scalar, type Value } from "./blocks";
import { LIMITS, PLACEHOLDER, type Arg, type Blueprint, type BlueprintSkill } from "./blueprint";

// the only way a run reaches outside itself; the caller decides what stands behind it
export type DataReader = (
  source: string,
  args: Record<string, Scalar>,
) => Promise<Record<string, unknown> | { error: string }>;

export interface SkillRun {
  state: "completed" | "input-required" | "failed";
  text: string;
  missing: string[];
  problems: string[];
  inputs: Record<string, number | string>;
  reads: Record<string, Record<string, Scalar>>;
  steps: Record<string, Record<string, Scalar>>;
  // set when the run stopped because live data could not be read, which is no fault of
  // the blueprint or the caller
  readFailed?: boolean;
}

export interface InputReading {
  values: Record<string, number | string>;
  missing: string[];
  problems: string[];
}

// far past any real balance or price, and small enough that the arithmetic stays finite
export const MAX_INPUT_MAGNITUDE = 1e15;

// "1,000", "$1000" and "80%" are how people write numbers; anything else is not guessed at
function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.length > 40) return null;
  const cleaned = raw.trim().replace(/^\$/, "").replace(/%$/, "").replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function readInputs(skill: BlueprintSkill, raw: Record<string, unknown> | undefined): InputReading {
  const values: Record<string, number | string> = {};
  const missing: string[] = [];
  const problems: string[] = [];
  for (const input of skill.inputs) {
    const given = raw ? own(raw, input.id) : undefined;
    if (given === undefined || given === null || given === "") {
      if (input.required) missing.push(input.id);
      continue;
    }
    if (input.type === "number") {
      const n = toNumber(given);
      if (n === null) problems.push(`${input.id} must be a number`);
      else if (Math.abs(n) > MAX_INPUT_MAGNITUDE) problems.push(`${input.id} is out of range`);
      else values[input.id] = n;
    } else if (typeof given === "string" && given.trim().length <= LIMITS.textValue) {
      values[input.id] = given.trim();
    } else {
      problems.push(`${input.id} must be text of at most ${LIMITS.textValue} characters`);
    }
  }
  return { values, missing, problems };
}

function isRef(arg: Arg): arg is { ref: string } {
  return typeof arg === "object" && arg !== null;
}

function resolveArgs(args: Record<string, Arg>, scope: Map<string, Value>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [key, arg] of Object.entries(args)) {
    const value = isRef(arg) ? scope.get(arg.ref) : arg;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function show(value: Value | undefined, decimals: string | undefined): string {
  if (value === undefined || value === null) return "not applicable";
  if (typeof value === "number") return decimals === undefined ? String(value) : value.toFixed(Number(decimals));
  if (typeof value === "boolean") return value ? "yes" : "no";
  return typeof value === "string" ? value : "not applicable";
}

export function renderAnswer(template: string, scope: Map<string, Value>): string {
  return template.replace(PLACEHOLDER, (_, ref: string, decimals: string | undefined) => show(scope.get(ref), decimals));
}

// a block names its own arguments; where one is fed straight from a caller's input, the
// caller is told about the input they sent, not the block's name for it
function inCallerTerms(problem: string, args: Record<string, Arg>): string {
  let out = problem;
  for (const [key, arg] of Object.entries(args)) {
    if (isRef(arg) && arg.ref.startsWith("input.")) out = out.replace(new RegExp(`\\b${key}\\b`, "g"), arg.ref.slice(6));
  }
  return out;
}

function scalarsOf(record: Record<string, unknown>, fields: string[]): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const field of fields) {
    const v = own(record, field);
    out[field] = typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : null;
  }
  return out;
}

export async function runSkill(
  skill: BlueprintSkill,
  rawInput: Record<string, unknown> | undefined,
  deps: { read?: DataReader } = {},
): Promise<SkillRun> {
  const reading = readInputs(skill, rawInput);
  const run: SkillRun = {
    state: "input-required",
    text: "",
    missing: reading.missing,
    problems: reading.problems,
    inputs: reading.values,
    reads: {},
    steps: {},
  };
  if (reading.missing.length || reading.problems.length) return run;

  const scope = new Map<string, Value>();
  for (const [id, value] of Object.entries(reading.values)) scope.set(`input.${id}`, value);

  for (const read of skill.reads) {
    const source = getSource(read.source);
    if (!source || !deps.read) {
      return { ...run, state: "failed", readFailed: true, problems: [`the ${read.source} data source is not available`] };
    }
    const args: Record<string, Scalar> = {};
    for (const [key, value] of Object.entries(resolveArgs(read.args, scope))) {
      if (typeof value !== "object" || value === null) args[key] = value;
    }
    // a reader that throws says nothing a caller should see, so only that it failed is kept
    const record = await deps.read(source.id, args).catch(() => ({ error: `the ${source.id} data source could not be read` }));
    if (typeof record.error === "string") {
      // a pair the source does not carry is the caller's to fix; anything else is the read failing
      const callerFault = /not a supported|must be/i.test(record.error);
      return callerFault
        ? { ...run, state: "input-required", problems: [record.error] }
        : { ...run, state: "failed", readFailed: true, problems: [record.error] };
    }
    scope.set(read.id, record);
    const fields = scalarsOf(record, Object.keys(source.outputs));
    for (const [field, value] of Object.entries(fields)) scope.set(`${read.id}.${field}`, value);
    run.reads[read.id] = fields;
  }

  for (const step of skill.steps) {
    const block = getBlock(step.block);
    if (!block) return { ...run, state: "failed", problems: [`the ${step.block} block is not available`] };
    const args = resolveArgs(step.args, scope);

    // an earlier step can leave a figure empty, such as a health factor with no debt; a
    // step that needs it cannot run, and no input the caller could send would change that
    const empty = Object.entries(step.args).find(
      ([key, arg]) => own(block.inputs, key)?.required && isRef(arg) && !arg.ref.startsWith("input.") && (args[key] === undefined || args[key] === null),
    );
    if (empty) {
      return { ...run, state: "failed", problems: [`${(empty[1] as { ref: string }).ref} has no value for these inputs`] };
    }

    const problems = block.check(args).map((p) => inCallerTerms(p, step.args));
    if (problems.length) return { ...run, state: "input-required", problems };
    let result: Record<string, Scalar>;
    try {
      result = block.run(args);
    } catch {
      return { ...run, state: "failed", problems: [`${step.block} could not be computed from these values`] };
    }
    // a figure that overflowed is not a figure; nothing unbounded is ever printed
    if (Object.values(result).some((v) => typeof v === "number" && !Number.isFinite(v))) {
      return { ...run, state: "failed", problems: [`${step.block} could not be computed from these values`] };
    }
    for (const [field, value] of Object.entries(result)) scope.set(`${step.id}.${field}`, value);
    run.steps[step.id] = result;
  }

  return { ...run, state: "completed", text: renderAnswer(skill.answer, scope) };
}

export interface ExampleCheck {
  // what is wrong with the blueprint, for the model to correct
  errors: string[];
  // live data that could not be read, which no correction would fix
  unavailable: string[];
}

// a blueprint is only offered once each skill's own example produces an answer, so a
// builder never sees an agent that cannot answer the request it advertises
export async function checkExamples(blueprint: Blueprint, deps: { read?: DataReader } = {}): Promise<ExampleCheck> {
  const out: ExampleCheck = { errors: [], unavailable: [] };
  for (const [i, skill] of blueprint.skills.entries()) {
    const run = await runSkill(skill, skill.example, deps);
    if (run.state === "completed") continue;
    const why = [...run.missing.map((m) => `${m} is missing`), ...run.problems].join("; ");
    if (run.readFailed) out.unavailable.push(`skills[${i}]: ${why}`);
    else out.errors.push(`skills[${i}].example: does not produce an answer (${why || run.state})`);
  }
  return out;
}
