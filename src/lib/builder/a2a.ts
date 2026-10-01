// how a built agent answers a caller: the same card and reply shapes the reference agents
// use, so the marketplace, the verifier and any A2A client treat it like any other agent

import { own, type Scalar } from "./blocks";
import type { Blueprint, BlueprintSkill } from "./blueprint";
import { runSkill, type DataReader } from "./run";

export interface BuiltMessage {
  task: string;
  input?: Record<string, unknown>;
}

export interface BuiltReply {
  state: "completed" | "input-required" | "failed";
  text: string;
  artifact: Record<string, unknown>;
}

// a sentence is searched for values only this far in; a real request is a line or two
const TASK_SEARCH_CHARS = 2000;

function exampleData(skill: BlueprintSkill): string {
  return JSON.stringify({ kind: "data", data: { input: skill.example } });
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "collateralUsd" is also written "collateral usd", and the label is how a person names it
function namesFor(input: { id: string; label: string }): string[] {
  const spaced = input.id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return [...new Set([input.id.toLowerCase(), spaced, input.label.toLowerCase().replace(/\s+/g, " ")])].filter(Boolean);
}

// values a caller wrote in a sentence, such as "collateral 1000 and debt 500"; a data part
// is the reliable channel, and this only saves a caller who used words.
// The text is cut short and its spaces collapsed first, and the pattern has one run of
// separators and no other optional space, so a long hostile message costs nothing to scan
export function inputsFromText(skill: BlueprintSkill, task: string): Record<string, number | string> {
  const text = task.slice(0, TASK_SEARCH_CHARS).replace(/\s+/g, " ");
  const found: Record<string, number | string> = {};
  for (const input of skill.inputs) {
    const names = namesFor(input).map(escapeRe).join("|");
    const lead = `(?:^|[^a-z0-9])(?:${names})[ :=]*(?:(?:is|of|at) )?`;
    if (input.type === "number") {
      const m = new RegExp(`${lead}\\$?(-?\\d[\\d,]*(?:\\.\\d+)?)`, "i").exec(text);
      if (m) found[input.id] = Number(m[1].replace(/,/g, ""));
    } else {
      const m = new RegExp(`${lead}([A-Za-z0-9][A-Za-z0-9/_.-]{0,39})`, "i").exec(text);
      if (m) found[input.id] = m[1];
    }
  }
  return found;
}

function mergedInput(skill: BlueprintSkill, message: BuiltMessage): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...inputsFromText(skill, message.task) };
  for (const input of skill.inputs) {
    const given = message.input ? own(message.input, input.id) : undefined;
    if (given !== undefined && given !== null && given !== "") merged[input.id] = given;
  }
  return merged;
}

// the skill a message is for: the one it names, or else the one whose inputs it carries
// a message carrying none of any skill's inputs is a question about the agent, not a task
export function pickSkill(blueprint: Blueprint, message: BuiltMessage): BlueprintSkill | null {
  const named = message.input ? own(message.input, "skill") : undefined;
  const byName = typeof named === "string" ? blueprint.skills.find((s) => s.id === named) : undefined;
  if (byName) return byName;
  let best: { skill: BlueprintSkill; hits: number } | null = null;
  for (const skill of blueprint.skills) {
    const hits = Object.keys(mergedInput(skill, message)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { skill, hits };
  }
  return best?.skill ?? null;
}

function skillLine(skill: BlueprintSkill): string {
  const needs = skill.inputs.filter((i) => i.required).map((i) => i.id);
  const optional = skill.inputs.filter((i) => !i.required).map((i) => i.id);
  const parts = [`${skill.name}: ${skill.description}`];
  if (needs.length) parts.push(`It needs ${needs.join(", ")}.`);
  if (optional.length) parts.push(`Optional: ${optional.join(", ")}.`);
  parts.push(`Send the values as a data part, for example ${exampleData(skill)}.`);
  return parts.join(" ");
}

export function capabilityReply(blueprint: Blueprint): BuiltReply {
  const choose =
    blueprint.skills.length > 1
      ? ` To pick a skill by name, add "skill" to the data part with one of ${blueprint.skills.map((s) => s.id).join(", ")}.`
      : "";
  return {
    state: "completed",
    text: `${blueprint.name}. ${blueprint.description} ${blueprint.skills.map(skillLine).join(" ")}${choose} Every figure is computed from the values you send and the data named in the answer, and nothing here signs or sends a transaction.`,
    artifact: {
      capability: blueprint.category,
      status: "ok",
      skills: blueprint.skills.map((s) => ({
        id: s.id,
        required: s.inputs.filter((i) => i.required).map((i) => i.id),
        optional: s.inputs.filter((i) => !i.required).map((i) => i.id),
        reads: s.reads.map((r) => r.source),
        example: { kind: "data", data: { input: s.example } },
      })),
      readOnly: true,
    },
  };
}

export async function answerBuiltAgent(
  blueprint: Blueprint,
  message: BuiltMessage,
  deps: { read?: DataReader } = {},
): Promise<BuiltReply> {
  const skill = pickSkill(blueprint, message);
  if (!skill) return capabilityReply(blueprint);

  const run = await runSkill(skill, mergedInput(skill, message), deps);
  const base = { capability: blueprint.category, skill: skill.id };
  if (run.state === "completed") {
    return {
      state: "completed",
      text: run.text,
      artifact: { ...base, status: "ok", inputs: run.inputs, sources: run.reads, result: run.steps, readOnly: true },
    };
  }
  if (run.state === "failed") {
    return {
      state: "failed",
      text: `I could not complete this, so I have not given a figure: ${run.problems.join("; ")}.`,
      artifact: { ...base, status: "failed", problems: run.problems },
    };
  }
  const lines = ["I cannot answer yet, and I will not guess the missing values."];
  if (run.missing.length) lines.push(`Provide ${run.missing.join(" and ")}.`);
  if (run.problems.length) lines.push(`Fix: ${run.problems.join("; ")}.`);
  lines.push(`Send them as a data part, for example ${exampleData(skill)}.`);
  return {
    state: "input-required",
    text: lines.join(" "),
    artifact: {
      ...base,
      status: "input-required",
      missing: run.missing,
      problems: run.problems,
      received: run.inputs,
      example: { kind: "data", data: { input: skill.example } },
      note: "Nothing is inferred from partial values.",
    },
  };
}

function exampleSentence(skill: BlueprintSkill): string {
  const values = Object.entries(skill.example).map(([k, v]: [string, Scalar]) => `${k} ${v}`);
  return `${skill.name} for ${values.join(", ")}`;
}

// the card a registry record points at; the example on each skill is what the agent page
// offers a buyer as a task that is known to work
export function builtAgentCard(blueprint: Blueprint, opts: { origin: string; id: string; version?: string }) {
  const base = `${opts.origin.replace(/\/+$/, "")}/api/built/${opts.id}`;
  const messagingUrl = `${base}/a2a`;
  return {
    name: blueprint.name,
    description: blueprint.description,
    version: opts.version ?? "1.0.0",
    url: messagingUrl,
    protocolVersion: "0.3.0",
    provider: { organization: "Built on Agent Souk", url: opts.origin.replace(/\/+$/, "") },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: blueprint.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: [...new Set([blueprint.category, ...skill.steps.map((s) => s.block)])],
      examples: [exampleSentence(skill)],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"],
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(
          skill.inputs.map((i) => [i.id, { type: i.type === "number" ? "number" : "string", description: i.description }]),
        ),
        required: skill.inputs.filter((i) => i.required).map((i) => i.id),
        examples: [skill.example],
      },
    })),
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}
