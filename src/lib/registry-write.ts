// Building an ERC-8004 registration and the calldata that mints it, pure and client-safe.

import { encodeFunctionData, getAddress, type Address } from "viem";

// observed identity registry per chain
export const REGISTRY_ADDRESSES: Record<number, Address> = {
  56: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
  97: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
};

export function registryAddress(chainId: number): Address {
  const address = REGISTRY_ADDRESSES[chainId];
  if (!address) {
    throw new Error(
      `No ERC-8004 identity registry is configured for chain ${chainId}. Add one to REGISTRY_ADDRESSES before listing agents there.`,
    );
  }
  return getAddress(address);
}

// the agentRegistry identifier from the spec, for example eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e
export function agentRegistryRef(chainId: number): string {
  return `eip155:${chainId}:${registryAddress(chainId).toLowerCase()}`;
}

export const REGISTER_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
] as const;

export function encodeRegister(chainId: number, agentUri: string): `0x${string}` {
  return encodeFunctionData({
    abi: REGISTER_ABI,
    functionName: "register",
    args: [agentUri],
  });
}

// re-exported so callers that import the validator keep working
import {
  LISTABLE_CATEGORIES,
  ENDPOINT_KINDS,
  type ListableCategory,
  type EndpointKind,
  type RegistrationDraft,
} from "@agora/core";

export {
  LISTABLE_CATEGORIES,
  ENDPOINT_KINDS,
  type ListableCategory,
  type EndpointKind,
  type RegistrationDraft,
};

export interface RegistrationService {
  name: string;
  endpoint: string;
  version?: string;
}

export interface RegistrationEntry {
  agentId: string;
  agentRegistry: string;
}

export interface RegistrationFile {
  type: string;
  name: string;
  description: string;
  image?: string;
  services: RegistrationService[];
  x402Support: boolean;
  active: boolean;
  registrations: RegistrationEntry[];
}

const LIMITS = {
  name: 80,
  description: 1000,
  endpoint: 300,
  image: 300,
} as const;

export interface DraftValidation {
  ok: boolean;
  errors: string[];
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// Brief item 4: what it does, how it is invoked, and an endpoint, since an agent nobody can call is not a listing.
export function validateDraft(draft: RegistrationDraft): DraftValidation {
  const errors: string[] = [];

  const name = (draft.name ?? "").trim();
  if (!name) errors.push("Name is required.");
  else if (name.length > LIMITS.name) errors.push(`Name must be ${LIMITS.name} characters or fewer.`);

  const description = (draft.description ?? "").trim();
  if (!description) {
    errors.push("Description is required: say what the agent does and how to use it.");
  } else if (description.length > LIMITS.description) {
    errors.push(`Description must be ${LIMITS.description} characters or fewer.`);
  }

  if (!LISTABLE_CATEGORIES.includes(draft.category)) {
    errors.push(`Category must be one of: ${LISTABLE_CATEGORIES.join(", ")}.`);
  }

  const endpoint = (draft.endpoint ?? "").trim();
  if (!endpoint) {
    errors.push("Endpoint is required: this is how a buyer invokes the agent.");
  } else if (endpoint.length > LIMITS.endpoint) {
    errors.push(`Endpoint must be ${LIMITS.endpoint} characters or fewer.`);
  } else if (!isHttpsUrl(endpoint)) {
    errors.push("Endpoint must be a reachable https URL.");
  }

  if (draft.endpointKind && !ENDPOINT_KINDS.includes(draft.endpointKind)) {
    errors.push(`Endpoint kind must be one of: ${ENDPOINT_KINDS.join(", ")}.`);
  }

  const image = (draft.image ?? "").trim();
  if (image && (image.length > LIMITS.image || !isHttpsUrl(image))) {
    errors.push("Image must be an https URL.");
  }

  return { ok: errors.length === 0, errors };
}

// registrations stays empty until the onchain id is known, because the URL never changes
export function buildRegistrationFile(input: {
  agentId?: string | number;
  chainId: number;
  draft: RegistrationDraft;
}): RegistrationFile {
  const draft = input.draft;
  const services: RegistrationService[] = [];
  const endpoint = (draft.endpoint ?? "").trim();
  if (endpoint) {
    services.push({ name: draft.endpointKind ?? "web", endpoint });
  }

  const registrations: RegistrationEntry[] = [];
  if (input.agentId !== undefined && input.agentId !== "") {
    registrations.push({
      agentId: String(input.agentId),
      agentRegistry: agentRegistryRef(input.chainId),
    });
  }

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: draft.name.trim(),
    description: draft.description.trim(),
    ...(draft.image?.trim() ? { image: draft.image.trim() } : {}),
    services,
    x402Support: draft.x402Support ?? true,
    active: true,
    registrations,
  };
}

// the agentURI a buyer signs over, at a claim URL that never has to change
export function registrationUrl(baseUrl: string, claimId: string): string {
  const root = baseUrl.replace(/\/+$/, "");
  return `${root}/api/agents/register/${encodeURIComponent(claimId)}`;
}
