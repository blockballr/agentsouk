import { NextRequest } from "next/server";
import { verifyMessage } from "viem";
import { isAddress, isNonce, isStationRole, stationMemberChangeMessage, type StationMember, type StationRole } from "@/lib/station";
import { requireMember, stationJson, stationRoute } from "@/lib/station-auth";
import { changeMember, listAudit, listMembers, recordAudit, spendNonce } from "@/lib/station-store";

export const dynamic = "force-dynamic";

// GET /api/station/members, for owners: who has access, and the log of what was done
export const GET = stationRoute(async (req: NextRequest) => {
  const { refusal } = await requireMember(req, "owner");
  if (refusal) return refusal;
  const [members, audit] = await Promise.all([listMembers(), listAudit(200)]);
  return stationJson({ success: true, members, audit });
});

// a change needs a signature over a nonce issued to the owner, so a borrowed session changes nothing
// the nonce is spent on arrival, so the same signed request is refused the second time
async function signedChange(
  req: NextRequest,
  actor: StationMember,
  change: (body: Record<string, unknown>) => StationRole | "remove" | null,
): Promise<{ target: string; change: StationRole | "remove" } | { error: string; status: number }> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isAddress(body.address)) return { error: "address must be a wallet address", status: 400 };
  const what = change(body);
  if (!what) return { error: "role must be owner, operator or viewer", status: 400 };
  const target = body.address.toLowerCase();
  const fresh = isNonce(body.nonce) && (await spendNonce(body.nonce, actor.address));
  const ok =
    fresh &&
    typeof body.signature === "string" &&
    (await verifyMessage({
      address: actor.address as `0x${string}`,
      message: stationMemberChangeMessage(actor.address, target, what, body.nonce as string),
      signature: body.signature as `0x${string}`,
    }).catch(() => false));
  if (!ok) {
    await recordAudit(actor.address, `refused: ${what === "remove" ? "remove" : `make ${what}`} ${target}`, "not signed for this change");
    return { error: "That change was not signed for. Sign it again with your wallet.", status: 401 };
  }
  return { target, change: what };
}

async function apply(actor: StationMember, target: string, next: StationRole | null) {
  const problem = await changeMember(target, next, actor.address);
  if (problem) {
    await recordAudit(actor.address, `refused: ${next ? `make ${next}` : "remove"} ${target}`, problem);
    return stationJson({ success: false, error: problem }, 409);
  }
  return stationJson({ success: true, members: await listMembers() });
}

// POST /api/station/members, for owners: add a member or change a member's role
export const POST = stationRoute(async (req: NextRequest) => {
  const { member, refusal } = await requireMember(req, "owner");
  if (refusal) return refusal;
  const signed = await signedChange(req, member, (b) => (isStationRole(b.role) ? b.role : null));
  if ("error" in signed) return stationJson({ success: false, error: signed.error }, signed.status);
  return apply(member, signed.target, signed.change as StationRole);
});

// DELETE /api/station/members, for owners: remove a member, which also ends their sessions
export const DELETE = stationRoute(async (req: NextRequest) => {
  const { member, refusal } = await requireMember(req, "owner");
  if (refusal) return refusal;
  const signed = await signedChange(req, member, () => "remove");
  if ("error" in signed) return stationJson({ success: false, error: signed.error }, signed.status);
  return apply(member, signed.target, null);
});
