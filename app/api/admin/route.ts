import { NextResponse } from "next/server";
import { grantAdmin } from "@/lib/queries";
import { getSession, matchesAdminKey } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    isAdmin: session.isAdmin,
    configured: Boolean(process.env.ADMIN_KEY),
  });
}

/** Attach the admin flag to the caller's device, given the shared ADMIN_KEY. */
export async function POST(req: Request) {
  const session = await getSession();
  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : "";

  if (!matchesAdminKey(key)) {
    return NextResponse.json({ error: "invalid key" }, { status: 403 });
  }
  await grantAdmin(session.userId);
  return NextResponse.json({ ok: true });
}
