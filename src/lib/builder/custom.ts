// Custom agent builder: manifest schema, validation, and in-memory store.
// Mirrors the strategy builder's hosting/export patterns but targets arbitrary
// on-chain execution code deployed to the user's own CreateOS principal.

import "server-only";
import { randomBytes } from "node:crypto";

export type CustomWalletModel = "agent" | "vault" | "session" | "none";
export type CustomPayment = "x402" | "job";

export interface CustomAction {
  name: string;
  venue: string;
  contracts: string[];
  functions: string[];
  maxValueUsd: number;
}

export interface CustomManifest {
  name: string;
  category: string;
  description: string;
  runtime: string;
  entrypoint: string;
  endpoint: string;
  wallet: CustomWalletModel;
  payment: CustomPayment;
  deliverable: string;
  release: string;
  actions: CustomAction[];
  env: string[];
  healthcheck: string;
}

export interface CustomAgent {
  id: string;
  owner: string;
  manifest: CustomManifest;
  buildId: string | null;
  deployment: { ok: boolean; projectId?: string | null; url?: string | null; error?: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

const ID = /^[0-9a-f]{16}$/;

const FORBIDDEN = /seed phrase|private key|mnemonic|secret key/i;

function isString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateCustomManifest(input: unknown): { ok: true; manifest: CustomManifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }
  const m = input as Record<string, unknown>;

  if (!isString(m.name)) errors.push("name is required");
  else if (FORBIDDEN.test(m.name)) errors.push("name contains forbidden terms");
  if (!isString(m.category)) errors.push("category is required");
  if (!isString(m.description)) errors.push("description is required");
  else if (FORBIDDEN.test(m.description)) errors.push("description contains forbidden terms");
  if (!isString(m.runtime)) errors.push("runtime is required");
  if (!isString(m.entrypoint)) errors.push("entrypoint is required");
  if (!isString(m.endpoint)) errors.push("endpoint is required");
  if (!isString(m.wallet)) errors.push("wallet is required");
  else if (!["agent", "vault", "session", "none"].includes(m.wallet as string)) errors.push("wallet must be agent, vault, session, or none");
  if (!isString(m.payment)) errors.push("payment is required");
  else if (!["x402", "job"].includes(m.payment as string)) errors.push("payment must be x402 or job");
  if (!isString(m.deliverable)) errors.push("deliverable is required");
  if (!isString(m.release)) errors.push("release is required");
  if (!isString(m.healthcheck)) errors.push("healthcheck is required");
  if (!isStringArray(m.env)) errors.push("env must be an array of strings");

  if (!Array.isArray(m.actions)) errors.push("actions must be an array");
  else {
    (m.actions as unknown[]).forEach((a, i) => {
      if (!a || typeof a !== "object" || Array.isArray(a)) { errors.push(`actions[${i}] must be an object`); return; }
      const act = a as Record<string, unknown>;
      if (!isString(act.name)) errors.push(`actions[${i}].name is required`);
      if (!isString(act.venue)) errors.push(`actions[${i}].venue is required`);
      if (!isStringArray(act.contracts)) errors.push(`actions[${i}].contracts must be an array of strings`);
      if (!isStringArray(act.functions)) errors.push(`actions[${i}].functions must be an array of strings`);
      if (typeof act.maxValueUsd !== "number" || !Number.isFinite(act.maxValueUsd) || act.maxValueUsd < 0) {
        errors.push(`actions[${i}].maxValueUsd must be a non-negative number`);
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const manifest: CustomManifest = {
    name: (m.name as string).trim(),
    category: (m.category as string).trim(),
    description: (m.description as string).trim(),
    runtime: (m.runtime as string).trim(),
    entrypoint: (m.entrypoint as string).trim(),
    endpoint: (m.endpoint as string).trim(),
    wallet: m.wallet as CustomWalletModel,
    payment: m.payment as CustomPayment,
    deliverable: (m.deliverable as string).trim(),
    release: (m.release as string).trim(),
    actions: (m.actions as unknown[]).map((a) => {
      const act = a as Record<string, unknown>;
      return {
        name: (act.name as string).trim(),
        venue: (act.venue as string).trim(),
        contracts: (act.contracts as string[]).map((x) => x.trim()),
        functions: (act.functions as string[]).map((x) => x.trim()),
        maxValueUsd: act.maxValueUsd as number,
      };
    }),
    env: (m.env as string[]).map((x) => x.trim()),
    healthcheck: (m.healthcheck as string).trim(),
  };
  return { ok: true, manifest };
}

// in-memory store (memory stands in where there is no database)
const memory = new Map<string, CustomAgent>();

export function isCustomId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export async function saveCustomAgent(owner: string, manifest: CustomManifest, buildId: string | null = null): Promise<CustomAgent> {
  const id = randomBytes(8).toString("hex");
  const now = new Date().toISOString();
  const agent: CustomAgent = {
    id,
    owner: owner.toLowerCase(),
    manifest,
    buildId,
    deployment: null,
    createdAt: now,
    updatedAt: now,
  };
  memory.set(id, agent);
  return agent;
}

export async function getCustomAgent(id: string): Promise<CustomAgent | undefined> {
  if (!isCustomId(id)) return undefined;
  return memory.get(id);
}

export async function listCustomByOwner(owner: string): Promise<CustomAgent[]> {
  const o = owner.toLowerCase();
  return [...memory.values()].filter((a) => a.owner === o).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateCustomAgent(id: string, patch: Partial<CustomAgent>): Promise<CustomAgent | undefined> {
  const a = memory.get(id);
  if (!a) return undefined;
  const next = { ...a, ...patch, updatedAt: new Date().toISOString() };
  memory.set(id, next);
  return next;
}

export function resetCustomAgentsForTests(): void {
  memory.clear();
}

// alias for callers that use the shorter name
export const validateManifest = validateCustomManifest;

export function buildId(): string {
  return randomBytes(8).toString("hex");
}