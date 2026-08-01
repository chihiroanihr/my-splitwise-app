import { NextResponse } from "next/server";
import { joinGroup } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Redeem an invite token. This is the only way into a group you don't own. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const session = await getSession();
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";

  const joined = await joinGroup(groupId, token, session.userId);
  if (!joined) {
    return NextResponse.json({ error: "invalid invite" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
