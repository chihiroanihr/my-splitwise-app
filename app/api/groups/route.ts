import { NextResponse } from "next/server";
import { listGroupsForUser, createGroup } from "@/lib/queries";
import { getSession } from "@/lib/session";

// Always hit the database; never prerender this at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    groups: await listGroupsForUser(session),
    isAdmin: session.isAdmin,
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const group = await createGroup(name, session.userId);
  return NextResponse.json({ group }, { status: 201 });
}
