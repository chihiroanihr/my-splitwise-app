import { NextResponse } from "next/server";
import { removeParticipant } from "@/lib/queries";
import { authorizeGroup, isDenied } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Remove someone's access to the group.
 *
 * Owners may evict anyone; anyone may remove themselves (leaving the group).
 * The owner is never removable — a group with no owner could never be renamed
 * or deleted again.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ groupId: string; userId: string }> }
) {
  const { groupId, userId } = await params;
  const auth = await authorizeGroup(groupId);
  if (isDenied(auth)) return auth;

  const isSelf = userId === auth.session.userId;
  if (!isSelf && auth.role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  const removed = await removeParticipant(groupId, userId);
  if (!removed) {
    return NextResponse.json(
      { error: "not a participant, or is the owner" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}
