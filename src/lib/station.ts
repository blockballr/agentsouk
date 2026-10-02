// the team panel's rules of access, kept free of server imports so they can be tested alone

export const STATION_ROLES = ["viewer", "operator", "owner"] as const;
export type StationRole = (typeof STATION_ROLES)[number];

export function isStationRole(value: unknown): value is StationRole {
  return typeof value === "string" && (STATION_ROLES as readonly string[]).includes(value);
}

export function roleAllows(have: StationRole, need: StationRole): boolean {
  return STATION_ROLES.indexOf(have) >= STATION_ROLES.indexOf(need);
}

export const NONCE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// named in everything a member signs, so a text shown by another site reads as out of place
export const STATION_SITE = "station.agentsouk.xyz";

export function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isNonce(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

// the nonce is spent on first use, so a captured signature opens nothing
export function stationSignInMessage(address: string, nonce: string): string {
  return [
    "Agent Souk station sign-in",
    `site: ${STATION_SITE}`,
    `address: ${address.toLowerCase()}`,
    `nonce: ${nonce}`,
  ].join("\n");
}

// one nonce, one change: the same signed text is refused the second time it arrives
export function stationMemberChangeMessage(actor: string, target: string, change: StationRole | "remove", nonce: string): string {
  return [
    "Agent Souk station member change",
    `site: ${STATION_SITE}`,
    `by: ${actor.toLowerCase()}`,
    `member: ${target.toLowerCase()}`,
    `change: ${change}`,
    `nonce: ${nonce}`,
  ].join("\n");
}

export interface StationMember {
  address: string;
  role: StationRole;
  addedBy: string | null;
  addedAt: string;
}

// the last owner can be neither removed nor demoted, or nobody could add the next one
export function memberChangeProblem(
  members: readonly StationMember[],
  target: string,
  next: StationRole | null,
): string | null {
  const t = target.toLowerCase();
  const current = members.find((m) => m.address === t);
  if (next === null && !current) return "that wallet is not a member";
  const ownersAfter = members.filter((m) => m.role === "owner" && m.address !== t).length + (next === "owner" ? 1 : 0);
  if (current?.role === "owner" && ownersAfter === 0) return "the station needs at least one owner";
  return null;
}
