import { NextResponse } from "next/server";
import { deleteMember } from "@/lib/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ groupId: string; memberId: string }> }
) {
  const { groupId, memberId } = await params;
  await deleteMember(groupId, memberId);
  return NextResponse.json({ ok: true });
}
