import { cookies, headers } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getUser, getRole } from "./queries";
import type { Role, Session } from "./types";

const COOKIE_NAME = "seisan_uid";
const TWO_YEARS = 60 * 60 * 24 * 365 * 2;

/**
 * Decide whether the session cookie may carry the Secure flag.
 *
 * Keying this off NODE_ENV alone breaks any http deployment of a production
 * build — `next start` is always "production", and Safari/WebKit refuses to
 * store a Secure cookie over http even on localhost, so every request would
 * arrive as a brand new anonymous user. Trust the proxy's protocol header when
 * present (Vercel always sets it), and otherwise assume anything that isn't
 * loopback is served over TLS.
 */
async function isSecureConnection(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim();
  if (proto) return proto === "https";
  const host = h.get("host") ?? "";
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
}

/**
 * Identify the caller by an httpOnly cookie, issuing one on first contact.
 * There are no passwords: possession of the cookie *is* the identity, so only
 * its digest is stored — a database leak alone cannot be replayed as a session.
 */
export async function getSession(): Promise<Session> {
  const store = await cookies();
  let secret = store.get(COOKIE_NAME)?.value;

  if (!secret) {
    secret = randomBytes(32).toString("base64url");
    store.set(COOKIE_NAME, secret, {
      httpOnly: true,
      secure: await isSecureConnection(),
      sameSite: "lax",
      path: "/",
      maxAge: TWO_YEARS,
    });
  }

  const key = createHash("sha256").update(secret).digest("hex");
  return getUser(key);
}

export type Authorized = { session: Session; role: Role };

/**
 * Resolve the caller's authority over a group.
 * Returns a 403 response instead of a role when they have no business here.
 * Admins are treated as owners of every group.
 */
export async function authorizeGroup(
  groupId: string,
  options: { ownerOnly?: boolean } = {}
): Promise<Authorized | NextResponse> {
  const session = await getSession();

  if (session.isAdmin) return { session, role: "owner" };

  const role = await getRole(groupId, session.userId);
  if (!role) {
    // Same response whether the group is missing or merely off-limits, so the
    // endpoint can't be used to probe which group ids exist.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (options.ownerOnly && role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }
  return { session, role };
}

export function isDenied(v: Authorized | NextResponse): v is NextResponse {
  return v instanceof NextResponse;
}

/** Constant-time comparison so the admin key can't be recovered by timing. */
export function matchesAdminKey(candidate: string): boolean {
  const expected = process.env.ADMIN_KEY;
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
