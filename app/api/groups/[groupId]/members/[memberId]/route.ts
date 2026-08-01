import { NextResponse } from "next/server";
import { deleteMember } from "@/lib/queries";
import { authorizeGroup, isDenied } from "@/lib/session";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ groupId: string; memberId: string }> }
) {
  const { groupId, memberId } = await params;
  const auth = await authorizeGroup(groupId);
  if (isDenied(auth)) return auth;

  await deleteMember(groupId, memberId);
  return NextResponse.json({ ok: true });
}
