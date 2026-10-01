// the record a prompt becomes: which blocks an agent runs, what it reads, what it asks the
// caller for and how it words its answer. Nothing here is code; a blueprint that does not
// pass validateBlueprint is never run and never shown

import { LISTABLE_CATEGORIES, type ListableCategory } from "@agora/core";
import { asksForSecrets } from "../quest-eligibility";
import { BLOCKS, DATA_SOURCES, getBlock, getSource, own, type FieldSpec, type FieldType } from "./blocks";

export const BLUEPRINT_VERSION = 1;

export const LIMITS = {
  skills: 3,
  inputs: 8,
  reads: 2,
  steps: 6,
  name: 60,
  description: 400,
  skillDescription: 300,
  label: 40,
  inputDescription: 160,
  answer: 600,
  // short enough that neither a key nor a recovery phrase fits in a text value
  textValue: 40,
} as const;

// a value written into the blueprint, or a pointer to one produced earlier in the run:
// "input.<id>", "<readId>" for a whole record, "<readId>.<field>" or "<stepId>.<field>"
export type Arg = number | string | boolean | { ref: string };

export interface BlueprintInput {
  id: string;
  label: string;
  type: "number" | "text";
  required: boolean;
  description: string;
}

export interface BlueprintRead {
  id: string;
  source: string;
  args: Record<string, Arg>;
}

export interface BlueprintStep {
  id: string;
  block: string;
  args: Record<string, Arg>;
}

export interface BlueprintSkill {
  id: string;
  name: string;
  description: string;
  inputs: BlueprintInput[];
  reads: BlueprintRead[];
  steps: BlueprintStep[];
  // the reply, with {ref} or {ref:decimals} wherever a value belongs
  answer: string;
  // inputs that produce a real answer, shown to the builder and used to prove the skill runs
  example: Record<string, number | string>;
}

export interface Blueprint {
  version: 1;
  name: string;
  category: ListableCategory;
  description: string;
  skills: BlueprintSkill[];
}

export type BlueprintCheck = { ok: true; blueprint: Blueprint } | { ok: false; errors: string[] };

const SKILL_ID = /^[a-z][a-z0-9-]{1,39}$/;
const NODE_ID = /^[a-z][A-Za-z0-9]{0,29}$/;
// a scheme, a www, a bare domain such as t.me/x, or an @handle
const LINK = /https?:|www\.|\b[a-z0-9][a-z0-9-]*\.[a-z]{2,}\b|(?:^|\s)@\w{3,}/i;
// line breaks of every kind, and the invisible characters that reorder or hide text
function hasHiddenCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f)) return true;
    if ((c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) return true;
  }
  return false;
}
// matched with matchAll and replace only, which never leave a position behind on it
export const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9.]*)(?::(\d))?\}/g;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRef(v: unknown): v is { ref: string } {
  return isRecord(v) && typeof v.ref === "string";
}

export function literalType(v: number | string | boolean): FieldType {
  return typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "text";
}

// every piece of text a blueprint carries can reach a buyer: in an answer, on the agent
// card, or in the agent's account of itself. None may carry a link or name a wallet secret
export function unsafeText(text: string): string | null {
  if (hasHiddenCharacter(text)) return "must be one line of plain text";
  if (LINK.test(text.replace(PLACEHOLDER, " "))) return "must not contain a link or a handle";
  if (asksForSecrets(text)) return "must not mention private keys, seed phrases, passwords or other wallet secrets";
  return null;
}

function checkText(errors: string[], path: string, value: unknown, min: number, max: number): string {
  if (typeof value !== "string") {
    errors.push(`${path}: must be text`);
    return "";
  }
  const text = value.trim();
  if (text.length < min || text.length > max) errors.push(`${path}: must be ${min} to ${max} characters`);
  const unsafe = unsafeText(text);
  if (unsafe) errors.push(`${path}: ${unsafe}`);
  return text;
}

// an id is read back to callers too ("Provide debt"), so it is held to the same rule
function checkId(errors: string[], path: string, value: unknown, shape: RegExp, rule: string): string {
  const id = typeof value === "string" ? value : "";
  if (!shape.test(id)) errors.push(`${path}: ${rule}`);
  else if (asksForSecrets(id)) errors.push(`${path}: must not name a wallet secret`);
  return id;
}

const NODE_RULE = "must start with a lowercase letter and use only letters and digits";

function checkArgs(
  errors: string[],
  path: string,
  raw: unknown,
  spec: Record<string, FieldSpec>,
  scope: Map<string, FieldType>,
  optionalInputs: Set<string>,
): Record<string, Arg> {
  const out: Record<string, Arg> = {};
  if (!isRecord(raw)) {
    errors.push(`${path}: must be an object of arguments`);
    return out;
  }
  for (const key of Object.keys(raw)) {
    if (!own(spec, key)) errors.push(`${path}.${key.slice(0, 40)}: not an argument here; use ${Object.keys(spec).join(", ")}`);
  }
  for (const [key, field] of Object.entries(spec)) {
    const value = own(raw, key);
    if (value === undefined || value === null) {
      if (field.required) errors.push(`${path}.${key}: required`);
      continue;
    }
    if (isRef(value)) {
      const type = scope.get(value.ref);
      if (!type) {
        errors.push(`${path}.${key}: "${value.ref.slice(0, 60)}" is not an input, read or earlier step result`);
      } else if (type !== field.type) {
        errors.push(`${path}.${key}: needs a ${field.type} but "${value.ref}" is a ${type}`);
      } else if (field.required && value.ref.startsWith("input.") && optionalInputs.has(value.ref.slice(6))) {
        errors.push(`${path}.${key}: required, so the input "${value.ref.slice(6)}" must be required too`);
      }
      out[key] = { ref: value.ref };
    } else if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      if (typeof value === "number" && !Number.isFinite(value)) {
        errors.push(`${path}.${key}: must be a finite number`);
      } else if (literalType(value) !== field.type) {
        errors.push(`${path}.${key}: needs a ${field.type}, got a ${literalType(value)}`);
      } else if (typeof value === "string") {
        // a label or a symbol written into the blueprint is printed in the answer as it stands
        const unsafe = value.length > LIMITS.textValue ? `must be at most ${LIMITS.textValue} characters` : unsafeText(value);
        if (unsafe) errors.push(`${path}.${key}: ${unsafe}`);
      }
      out[key] = value;
    } else {
      errors.push(`${path}.${key}: must be a value or { "ref": "..." }`);
    }
  }
  return out;
}

function checkSkill(errors: string[], path: string, raw: unknown): BlueprintSkill | null {
  if (!isRecord(raw)) {
    errors.push(`${path}: must be an object`);
    return null;
  }
  const id = checkId(errors, `${path}.id`, raw.id, SKILL_ID, "must be lowercase letters, digits and dashes, 2 to 40 characters");
  const name = checkText(errors, `${path}.name`, raw.name, 3, LIMITS.name);
  const description = checkText(errors, `${path}.description`, raw.description, 10, LIMITS.skillDescription);

  // what a ref may point at, filled in the order a run produces the values
  const scope = new Map<string, FieldType>();
  const optionalInputs = new Set<string>();
  const taken = new Set<string>(["input"]);

  const inputs: BlueprintInput[] = [];
  const rawInputs = Array.isArray(raw.inputs) ? raw.inputs : null;
  if (!rawInputs) errors.push(`${path}.inputs: must be a list`);
  else if (rawInputs.length > LIMITS.inputs) errors.push(`${path}.inputs: at most ${LIMITS.inputs}`);
  (rawInputs ?? []).slice(0, LIMITS.inputs).forEach((entry, i) => {
    const at = `${path}.inputs[${i}]`;
    if (!isRecord(entry)) return void errors.push(`${at}: must be an object`);
    const inputId = checkId(errors, `${at}.id`, entry.id, NODE_ID, NODE_RULE);
    if (inputId && scope.has(`input.${inputId}`)) errors.push(`${at}.id: "${inputId}" is used twice`);
    if (entry.type !== "number" && entry.type !== "text") errors.push(`${at}.type: must be "number" or "text"`);
    if (typeof entry.required !== "boolean") errors.push(`${at}.required: must be true or false`);
    const type = entry.type === "text" ? "text" : "number";
    scope.set(`input.${inputId}`, type);
    if (entry.required !== true) optionalInputs.add(inputId);
    inputs.push({
      id: inputId,
      label: checkText(errors, `${at}.label`, entry.label, 1, LIMITS.label),
      type,
      required: entry.required === true,
      description: checkText(errors, `${at}.description`, entry.description, 3, LIMITS.inputDescription),
    });
  });
  // a message carrying none of a skill's inputs is read as a question about the agent, so a
  // skill that asks for nothing could never be reached
  if (rawInputs && !inputs.some((i) => i.required)) errors.push(`${path}.inputs: needs at least one required input`);

  const nodeId = (at: string, value: unknown): string => {
    const node = checkId(errors, `${at}.id`, value, NODE_ID, NODE_RULE);
    if (node && taken.has(node)) errors.push(`${at}.id: "${node}" is already used in this skill`);
    taken.add(node);
    return node;
  };

  const reads: BlueprintRead[] = [];
  const rawReads = raw.reads === undefined ? [] : Array.isArray(raw.reads) ? raw.reads : null;
  if (!rawReads) errors.push(`${path}.reads: must be a list`);
  else if (rawReads.length > LIMITS.reads) errors.push(`${path}.reads: at most ${LIMITS.reads}`);
  (rawReads ?? []).slice(0, LIMITS.reads).forEach((entry, i) => {
    const at = `${path}.reads[${i}]`;
    if (!isRecord(entry)) return void errors.push(`${at}: must be an object`);
    const readId = nodeId(at, entry.id);
    const source = getSource(entry.source);
    if (!source) {
      errors.push(`${at}.source: not an approved data source; use ${Object.keys(DATA_SOURCES).join(", ")}`);
      return;
    }
    const args = checkArgs(errors, `${at}.args`, entry.args ?? {}, source.args, scope, optionalInputs);
    scope.set(readId, source.record);
    for (const [field, out] of Object.entries(source.outputs)) scope.set(`${readId}.${field}`, out.type);
    reads.push({ id: readId, source: source.id, args });
  });

  const steps: BlueprintStep[] = [];
  const stepRefs = new Set<string>();
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : null;
  if (!rawSteps || rawSteps.length < 1) errors.push(`${path}.steps: needs at least one step`);
  else if (rawSteps.length > LIMITS.steps) errors.push(`${path}.steps: at most ${LIMITS.steps}`);
  (rawSteps ?? []).slice(0, LIMITS.steps).forEach((entry, i) => {
    const at = `${path}.steps[${i}]`;
    if (!isRecord(entry)) return void errors.push(`${at}: must be an object`);
    const stepId = nodeId(at, entry.id);
    const block = getBlock(entry.block);
    if (!block) {
      errors.push(`${at}.block: not a known block; use ${Object.keys(BLOCKS).join(", ")}`);
      return;
    }
    const args = checkArgs(errors, `${at}.args`, entry.args ?? {}, block.inputs, scope, optionalInputs);
    for (const [field, out] of Object.entries(block.outputs)) {
      scope.set(`${stepId}.${field}`, out.type);
      stepRefs.add(`${stepId}.${field}`);
    }
    steps.push({ id: stepId, block: block.id, args });
  });

  const answer = checkText(errors, `${path}.answer`, raw.answer, 10, LIMITS.answer);
  let usesStep = false;
  for (const match of answer.matchAll(PLACEHOLDER)) {
    const [, ref, decimals] = match;
    const type = scope.get(ref);
    if (!type) errors.push(`${path}.answer: {${ref}} is not an input, read field or step result`);
    else if (type === "pool") errors.push(`${path}.answer: {${ref}} is a whole record; name one of its fields`);
    else if (decimals !== undefined && type !== "number") errors.push(`${path}.answer: {${ref}:${decimals}} rounds a ${type}`);
    if (stepRefs.has(ref)) usesStep = true;
  }
  if (/[{}]/.test(answer.replace(PLACEHOLDER, ""))) {
    errors.push(`${path}.answer: a brace is only for a placeholder such as {step.field} or {step.field:2}`);
  }
  if (!usesStep && steps.length) errors.push(`${path}.answer: must state at least one step result`);

  const example: Record<string, number | string> = {};
  if (!isRecord(raw.example)) {
    errors.push(`${path}.example: must be an object of example inputs`);
  } else {
    for (const key of Object.keys(raw.example)) {
      if (!scope.has(`input.${key}`)) errors.push(`${path}.example.${key.slice(0, 40)}: not one of this skill's inputs`);
    }
    for (const input of inputs) {
      const value = own(raw.example, input.id);
      if (value === undefined || value === null) {
        if (input.required) errors.push(`${path}.example.${input.id}: required`);
      } else if (input.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path}.example.${input.id}: must be a number`);
        else example[input.id] = value;
      } else if (typeof value !== "string") {
        errors.push(`${path}.example.${input.id}: must be a text`);
      } else {
        // the example is printed on the agent card and in the agent's account of itself
        const unsafe = value.length > LIMITS.textValue ? `must be at most ${LIMITS.textValue} characters` : unsafeText(value);
        if (unsafe) errors.push(`${path}.example.${input.id}: ${unsafe}`);
        example[input.id] = value;
      }
    }
  }

  return { id, name, description, inputs, reads, steps, answer, example };
}

// returns a clean copy holding only the fields the schema knows, so nothing the model
// added on the side travels with the blueprint
export function validateBlueprint(raw: unknown): BlueprintCheck {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["the blueprint must be a JSON object"] };
  if (raw.version !== BLUEPRINT_VERSION) errors.push(`version: must be ${BLUEPRINT_VERSION}`);
  const name = checkText(errors, "name", raw.name, 3, LIMITS.name);
  const description = checkText(errors, "description", raw.description, 20, LIMITS.description);
  const category = LISTABLE_CATEGORIES.find((c) => c === raw.category);
  if (!category) errors.push(`category: must be one of ${LISTABLE_CATEGORIES.join(", ")}`);

  const skills: BlueprintSkill[] = [];
  const rawSkills = Array.isArray(raw.skills) ? raw.skills : null;
  if (!rawSkills || rawSkills.length < 1) errors.push("skills: needs at least one skill");
  else if (rawSkills.length > LIMITS.skills) errors.push(`skills: at most ${LIMITS.skills}`);
  const seen = new Set<string>();
  (rawSkills ?? []).slice(0, LIMITS.skills).forEach((entry, i) => {
    const skill = checkSkill(errors, `skills[${i}]`, entry);
    if (!skill) return;
    if (seen.has(skill.id)) errors.push(`skills[${i}].id: "${skill.id}" is used twice`);
    seen.add(skill.id);
    skills.push(skill);
  });

  if (errors.length || !category) return { ok: false, errors };
  return { ok: true, blueprint: { version: BLUEPRINT_VERSION, name, category, description, skills } };
}
