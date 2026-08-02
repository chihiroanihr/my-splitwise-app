import { NextResponse } from "next/server";
import { listParticipants, rotateInviteToken } from "@/lib/queries";
import { authorizeGroup, isDenied } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Who currently has access. Visible to everyone already inside the group. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorizeGroup(groupId);
  if (isDenied(auth)) return auth;

  const participants = await listParticipants(groupId);
  return NextResponse.json({
    participants: participants.map((p) => ({
      ...p,
      isYou: p.userId === auth.session.userId,
    })),
  });
}

/** Rotate the invite token, killing every link handed out so far. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorizeGroup(groupId, { ownerOnly: true });
  if (isDenied(auth)) return auth;

  const inviteToken = await rotateInviteToken(groupId);
  return NextResponse.json({ inviteToken });
}
