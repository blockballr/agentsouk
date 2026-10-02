// what an owner may change about how their listing reads on Agent Souk: the description,
// up to three examples of what to send, and the image. The registry record is never touched.
// apps/web/src/lib/listing-edit.ts carries the same rules and message, and a test keeps the
// two equal, because the site signs exactly what the route verifies

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
  // the request in words
  task: string;
  // the values to send with it, as compact JSON text of one object, or nothing
  input: string | null;
}

export interface ListingEdit {
  // nothing here means the registry's own text is shown
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

// the compact JSON of one plain object, or null when the text is not that
export function compactJsonObject(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? JSON.stringify(parsed) : null;
  } catch {
    return null;
  }
}

// returns a clean copy holding only what the rules know, so nothing else is stored or signed
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

// the exact text that is hashed: strings only, in a fixed order, so both sides agree
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

// what the owner signs: bound to the token, the owner, the content and the moment, so a
// captured signature cannot change another listing, carry other content, or be replayed later
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

// how long a signed edit may take to arrive
export const EDIT_SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

export interface StoredListingEdit extends ListingEdit {
  updatedAt: string;
}

// what an API response says about an edited listing, beside the fields it replaces
export interface ListingView {
  edited: true;
  updatedAt: string;
  examples: ListingExample[];
  // the registry's own text and image, kept visible so an edit never hides the record
  registryDescription: string | null;
  registryImage: string | null;
}

// lays an owner's edit over a registry record without losing what the registry said
export function withListingEdit<T extends { description?: string | null; image_url?: string | null }>(
  agent: T,
  edit: StoredListingEdit | undefined,
): T & { listing?: ListingView } {
  if (!edit || isEmptyEdit(edit)) return agent;
  return {
    ...agent,
    description: edit.description ?? agent.description ?? null,
    image_url: edit.imageUrl ?? agent.image_url ?? null,
    listing: {
      edited: true,
      updatedAt: edit.updatedAt,
      examples: edit.examples,
      registryDescription: agent.description ?? null,
      registryImage: agent.image_url ?? null,
    },
  };
}
