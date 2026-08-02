import { NextResponse } from "next/server";
import { grantAdmin } from "@/lib/queries";
import { getSession, matchesAdminKey } from "@/lib/session";
import { rateLimit, clientKey } from "@/lib/rate-limit";

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

  // Only *failures* are throttled. Rate-limiting every attempt would let a
  // stranger on a shared network lock the real owner out of their own admin
  // page, while doing nothing extra against a brute-force attempt — which by
  // definition never sends the right key.
  if (!matchesAdminKey(key)) {
    const limit = rateLimit(clientKey(req, "admin"), 5, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "試行回数が多すぎます。しばらく待ってからお試しください" },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
      );
    }
    return NextResponse.json({ error: "invalid key" }, { status: 403 });
  }
  await grantAdmin(session.userId);
  return NextResponse.json({ ok: true });
}
