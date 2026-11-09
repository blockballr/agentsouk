import { CliError } from "../core/errors";
import { apiRequest } from "../core/http";
import type { CliConfig } from "../core/config";
import type { LoadedSigner } from "../core/wallet";

// The signature the marketplace checks covers the edited content itself, so the
// CLI has to canonicalise an edit exactly as src/lib/listing-edit.ts does. The
// rules are copied rather than imported because the CLI ships on its own, and a
// test keeps the two copies equal.

export const EDIT_LIMITS = {
  descriptionMin: 20,
  descriptionMax: 600,
  examples: 3,
  taskMin: 10,
  taskMax: 300,
  inputMax: 1000,
  imageMax: 300,
} as const;

export interface ListingExample {
  task: string;
  input: string | null;
}

export interface ListingEdit {
  description: string | null;
  examples: ListingExample[];
  imageUrl: string | null;
}

export type EditCheck = { ok: true; edit: ListingEdit } | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function compactJsonObject(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? JSON.stringify(parsed) : null;
  } catch {
    return null;
  }
}

export function checkListingEdit(raw: unknown): EditCheck {
  if (!isRecord(raw)) return { ok: false, errors: ["the edit must be an object"] };
  const errors: string[] = [];

  let description: string | null = null;
  if (raw.description !== null && raw.description !== undefined && raw.description !== "") {
    if (typeof raw.description !== "string") errors.push("description must be text");
    else {
      description = oneLine(raw.description);
      if (description.length < EDIT_LIMITS.descriptionMin || description.length > EDIT_LIMITS.descriptionMax) {
        errors.push(`description must be ${EDIT_LIMITS.descriptionMin} to ${EDIT_LIMITS.descriptionMax} characters`);
      }
    }
  }

  const examples: ListingExample[] = [];
  const rawExamples = raw.examples === undefined || raw.examples === null ? [] : raw.examples;
  if (!Array.isArray(rawExamples)) errors.push("examples must be a list");
  else if (rawExamples.length > EDIT_LIMITS.examples) errors.push(`at most ${EDIT_LIMITS.examples} examples`);
  else {
    rawExamples.forEach((entry, i) => {
      const at = `example ${i + 1}`;
      if (!isRecord(entry) || typeof entry.task !== "string") return void errors.push(`${at}: needs a request in words`);
      const task = oneLine(entry.task);
      if (task.length < EDIT_LIMITS.taskMin || task.length > EDIT_LIMITS.taskMax) {
        errors.push(`${at}: the request must be ${EDIT_LIMITS.taskMin} to ${EDIT_LIMITS.taskMax} characters`);
      }
      let input: string | null = null;
      if (entry.input !== null && entry.input !== undefined && entry.input !== "") {
        const compact = typeof entry.input === "string" ? compactJsonObject(entry.input) : null;
        if (compact === null) errors.push(`${at}: the values must be one JSON object, such as {"collateral":1000}`);
        else if (compact.length > EDIT_LIMITS.inputMax) errors.push(`${at}: the values must fit ${EDIT_LIMITS.inputMax} characters`);
        else input = compact;
      }
      examples.push({ task, input });
    });
  }

  let imageUrl: string | null = null;
  if (raw.imageUrl !== null && raw.imageUrl !== undefined && raw.imageUrl !== "") {
    const text = typeof raw.imageUrl === "string" ? raw.imageUrl.trim() : "";
    let parsed: URL | null = null;
    try {
      parsed = new URL(text);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:" || text.length > EDIT_LIMITS.imageMax) {
      errors.push(`the image must be an https address of at most ${EDIT_LIMITS.imageMax} characters`);
    } else {
      imageUrl = parsed.toString();
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, edit: { description, examples, imageUrl } };
}

export function isEmptyEdit(edit: ListingEdit): boolean {
  return edit.description === null && edit.examples.length === 0 && edit.imageUrl === null;
}

export function canonicalEdit(edit: ListingEdit): string {
  return JSON.stringify([
    edit.description,
    edit.examples.map((e) => [e.task, e.input]),
    edit.imageUrl,
  ]);
}

export async function editDigest(edit: ListingEdit): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalEdit(edit));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function listingEditMessage(
  chainId: number,
  tokenId: string,
  owner: string,
  digest: string,
  issuedAt: string,
): string {
  return [
    "Agent Souk listing edit",
    `chainId: ${chainId}`,
    `tokenId: ${tokenId}`,
    `owner: ${owner.toLowerCase()}`,
    `content: sha256:${digest}`,
    `issuedAt: ${issuedAt}`,
  ].join("\n");
}

export interface PrepareEdit {
  edit: ListingEdit;
  issuedAt: string;
  digest: string;
  message: string;
  clear: boolean;
}

// what the owner is about to sign, worked out without a key so it can be shown first
export async function prepareEdit(
  chainId: number,
  tokenId: string,
  owner: string,
  raw: unknown,
): Promise<PrepareEdit> {
  const checked = checkListingEdit(raw);
  if (!checked.ok) throw new CliError(checked.errors.join("; "), "edit_invalid", 2);
  const issuedAt = new Date().toISOString();
  const digest = await editDigest(checked.edit);
  return {
    edit: checked.edit,
    issuedAt,
    digest,
    message: listingEditMessage(chainId, tokenId, owner, digest, issuedAt),
    clear: isEmptyEdit(checked.edit),
  };
}

export interface EditResult {
  success?: boolean;
  tokenId?: string;
  listing?: (ListingEdit & { updatedAt: string }) | null;
  error?: string;
}

export async function editListing(
  config: CliConfig,
  signer: LoadedSigner,
  chainId: number,
  tokenId: string,
  prepared: PrepareEdit,
): Promise<EditResult> {
  const signature = await signer.signMessage(prepared.message);
  return apiRequest<EditResult>(config.apiUrl, `/api/agents/${chainId}/${tokenId}/listing`, {
    method: "POST",
    body: {
      owner: signer.address,
      signature,
      issuedAt: prepared.issuedAt,
      edit: prepared.edit,
    },
    timeoutMs: 30_000,
  });
}
