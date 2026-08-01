import { NextResponse } from "next/server";
import { addMember } from "@/lib/queries";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const member = await addMember(groupId, name);
  return NextResponse.json({ member }, { status: 201 });
}
