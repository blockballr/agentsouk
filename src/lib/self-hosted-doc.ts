// A lister may host the registration document at their own domain instead of
// taking our claim URL. The document is read from the server at prepare, its
// shape is checked, and prepare answers with calldata for that exact uri; the
// chain verify at confirm is the same code as the claim flow, with a different
// expected uri. Nothing is served at a claim url for this listing.

import dns from "node:dns/promises";
import { type RegistrationFile, type RegistrationDraft } from "@/lib/registry-write";

export const REGISTRATION_DOC_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_DOC_HOPS = 5;
export const DOC_TIMEOUT_MS = 5000;

// a private or unroutable address per the ssrf brief: loopback, rfc1918,
// link-local, the 0.0.0.0/8 block, and its ipv6 counterparts. Pure so the
// tests can cover it without touching the network.
export function ipForbidden(ip: string): boolean {
  if (ip.includes("%")) {
    // keep the scope id for the v6 link-local checks below
    const at = ip.indexOf("%");
    if (ip.slice(0, at) === "::1") return true;
  }
  const bare = ip.split("%")[0];
  if (bare === "::1" || bare === "::") return true;
  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return ipForbidden(mapped[1]);
  if (/^0\.|^0$/.test(bare)) return true;
  if (bare.startsWith("10.")) return true;
  if (bare.startsWith("192.168.")) return true;
  if (bare.startsWith("169.254.")) return true;
  if (bare.startsWith("fc") || bare.startsWith("fd")) return true;
  // fe80::/10 is link-local; every other fe prefix is routable
  if (/^fe[89ab]/i.test(bare)) return true;
  const octets = bare.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (octets) {
    const a = Number(octets[1]);
    const b = Number(octets[2]);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export type SelfHostedRead =
  | { ok: true; file: RegistrationFile; locator: string }
  | { ok: false; error: string };

// a bare ip literal needs no dns round trip; a v6 literal is bracketed in urls
// and bare in every other comparison, so both shapes are checked against the
// same forbidden list before the lookup path runs
function isIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[/, "").replace(/\]$/, "");
  return /^\d+\.\d+\.\d+\.\d+$/.test(bare) || bare.includes(":") === true;
}

async function hopAllowed(url: URL): Promise<void> {
  if (isIpLiteral(url.hostname)) {
    const bare = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (ipForbidden(bare)) {
      throw new Error("That link points at a host the marketplace will not read.");
    }
    return;
  }
  const answers = await dns.lookup(url.hostname, { all: true });
  if (answers.length === 0) throw new Error("That host does not resolve.");
  for (const answer of answers) {
    if (ipForbidden(answer.address)) {
      throw new Error("That link points at a host the marketplace will not read.");
    }
  }
}

async function readBody(res: Response): Promise<string> {
  const declared = res.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new Error(`The document is larger than ${MAX_BODY_BYTES} bytes.`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The document had no body.");
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      // the declared length lies: stop reading the stream itself
      await reader.cancel();
      throw new Error(`The document is larger than ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// fetches one hop at a time with redirect: manual, because a 302 answer
// pointing inside the network is the classic ssrf hop. Every hop is rechecked.
async function fetchSelfHostedDocument(uri: URL): Promise<Response> {
  let current = uri;
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_DOC_HOPS; hop += 1) {
    await hopAllowed(current);
    res = await fetch(current.toString(), {
      redirect: "manual",
      headers: { accept: "application/json" },
      credentials: "omit",
      signal: AbortSignal.timeout(DOC_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("The host answered a redirect with no target.");
      try {
        current = new URL(location, current);
        // only public https: a hop downgrading to http is refused, not followed
        if (current.protocol !== "https:") {
          throw new Error("The redirect does not stay on https.");
        }
        // one per hop: cancel and move
        await res.body?.cancel().catch(() => undefined);
        continue;
      } finally {
        // the reader is the caller's to close; a body already moved on
      }
    }
    if (!res.ok) throw new Error(`The host answered ${res.status}.`);
    return res;
  }
  throw new Error(`The link redirects more than ${MAX_DOC_HOPS} times.`);
}

export async function readSelfHostedDocument(rawUri: string): Promise<SelfHostedRead> {
  let uri: URL;
  try {
    uri = new URL(rawUri);
  } catch {
    return { ok: false, error: "That link is not a valid URL." };
  }
  if (uri.protocol !== "https:") {
    return { ok: false, error: "The link must be https." };
  }
  try {
    const res = await fetchSelfHostedDocument(uri);
    const body = await readBody(res);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("The link did not return a JSON document.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "The link returned something that is not a registration document." };
    }
    return {
      ok: true,
      file: parsed as RegistrationFile,
      locator: uri.toString().replace(/\/+$/, ""),
    };
  } catch (e) {
    const message = (e as Error).message ?? "";
    return { ok: false, error: message.replace(/Failed to fetch.*/, "The host did not answer.") };
  }
}

// The registered document must match the wizard draft, since the chain Fact is
// the join: the doc's name is what a listing carries, and the a2a endpoint is
// what the certifications need to route. the shared v1 shape: type is required,
// name and description are strings, services is a list with an a2a entry and
// a non-zero url, and registrations must be absent or empty for a new listing.
export type SelfHostedCheck =
  | { ok: true; draft: RegistrationDraft }
  | { ok: false; error: string };

export function readSelfHostedFileAgainst(file: RegistrationFile, draft: RegistrationDraft): SelfHostedCheck {
  if (typeof file.type !== "string" || file.type.trim() !== REGISTRATION_DOC_TYPE) {
    return { ok: false, error: "The document is not registration-v1: the type must be the ERC-8004 registration-v1 type." };
  }
  if (typeof file.name !== "string" || !file.name.trim() || file.name.trim().length > 80) {
    return { ok: false, error: "The document carries no usable name." };
  }
  if (file.name.trim() !== draft.name.trim()) {
    return { ok: false, error: "The document's name does not match the listing." };
  }
  if (typeof file.description !== "string" || !file.description.trim() || file.description.trim().length > 1000) {
    return { ok: false, error: "The document carries no usable description." };
  }
  if (!Array.isArray(file.services) || file.services.length === 0) {
    return { ok: false, error: "The document has no services." };
  }
  if (Array.isArray(file.registrations) && file.registrations.length > 0) {
    return { ok: false, error: "The document claims to be registered somewhere already, so this registration cannot mint it." };
  }
  const at = (file.services ?? []).find((s) => String((s as { name?: unknown })?.name ?? "").toLowerCase() === "a2a");
  const a2aEndpoint = String((at as { url?: unknown })?.url ?? (at as { endpoint?: unknown })?.endpoint ?? "");
  if (!a2aEndpoint) {
    return { ok: false, error: "The document has no a2a service endpoint, which is what the certifications need." };
  }
  const same = isSameEndpoint(a2aEndpoint, draft.endpoint ?? "");
  if (!same) {
    return { ok: false, error: "The document's a2a endpoint does not match the listing's endpoint." };
  }
  const draftOut: RegistrationDraft = {
    ...draft,
    name: file.name.trim(),
    description: file.description.trim(),
    endpoint: draft.endpoint ?? a2aEndpoint,
  };
  return { ok: true, draft: draftOut };
}

function isSameEndpoint(left: string, right: string): boolean {
  if (!left || !right) return false;
  const strip = (s: string) => s.trim().replace(/\/+$/, "").toLowerCase();
  return strip(left) === strip(right);
}

// the rebuild's reading: the document is authoritative, so name and words may
// drift from what the shelf froze at confirm. shape is still gated, and the
// base draft supplies what the document does not carry: category and wallet
export function draftFromSelfHostedFile(
  file: RegistrationFile,
  base: RegistrationDraft,
): SelfHostedCheck {
  if (typeof file.type !== "string" || file.type.trim() !== REGISTRATION_DOC_TYPE) {
    return { ok: false, error: "The document is not registration-v1." };
  }
  if (typeof file.name !== "string" || !file.name.trim() || file.name.trim().length > 80) {
    return { ok: false, error: "The document carries no usable name." };
  }
  if (typeof file.description !== "string" || !file.description.trim() || file.description.trim().length > 1000) {
    return { ok: false, error: "The document carries no usable description." };
  }
  if (!Array.isArray(file.services) || file.services.length === 0) {
    return { ok: false, error: "The document has no services." };
  }
  if (Array.isArray(file.registrations) && file.registrations.length > 0) {
    return { ok: false, error: "The document claims registrations this rebuild cannot re-mint." };
  }
  const services = (file.services ?? []).map((s) => ({
    name: String((s as { name?: unknown })?.name ?? "").toLowerCase(),
    url: String((s as { url?: unknown })?.url ?? (s as { endpoint?: unknown })?.endpoint ?? ""),
  }));
  const a2a = services.find((s) => s.name.includes("a2a") && s.url);
  const mcp = services.find((s) => s.name.includes("mcp") && s.url);
  const web = services.find((s) => s.name.includes("web") && s.url);
  const endpoint = a2a?.url ?? mcp?.url ?? web?.url ?? "";
  if (!endpoint) {
    return { ok: false, error: "The document has no service endpoint." };
  }
  const kinds: RegistrationDraft["endpointKinds"] = [
    ...(a2a ? (["A2A"] as const) : []),
    ...(mcp ? (["MCP"] as const) : []),
    ...(web && !a2a && !mcp ? (["web"] as const) : []),
  ];
  const draft: RegistrationDraft = {
    ...base,
    name: file.name.trim(),
    description: file.description.trim(),
    endpoint,
    endpointKinds: kinds.length > 0 ? [...kinds] : ["A2A"],
    ...(typeof file.image === "string" && file.image.trim() ? { image: file.image.trim() } : {}),
    ...(typeof file.x402Support === "boolean" ? { x402Support: file.x402Support } : {}),
    selfHosted: true,
    ownUri: base.ownUri,
  };
  return { ok: true, draft };
}

// a rebuild re-reads every self hosted document; a short ttl keeps two rebuilds
// in the same window from doubling the fetches without freezing the text
const DOC_CACHE_TTL_MS = 10 * 60 * 1000;
const docCache = new Map<string, { at: number; file: RegistrationFile }>();

export function resetSelfHostedDocCache(): void {
  docCache.clear();
}

export async function readSelfHostedDocumentCached(
  uri: string,
): Promise<SelfHostedRead> {
  const key = uri.trim().replace(/\/+$/, "");
  const cached = docCache.get(key);
  if (cached && Date.now() - cached.at < DOC_CACHE_TTL_MS) {
    return { ok: true, file: cached.file, locator: key };
  }
  const read = await readSelfHostedDocument(key);
  if (read.ok) {
    docCache.set(key, { at: Date.now(), file: read.file });
  }
  return read;
}
