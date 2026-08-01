import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "seisan_uid";
const TWO_YEARS = 60 * 60 * 24 * 365 * 2;

/**
 * Hand every visitor an identity cookie on their very first request.
 *
 * Issuing it lazily from the API routes instead leaves a race: a visitor who
 * submits before the first GET's Set-Cookie has landed sends the mutation with
 * no cookie, so it is recorded against a throwaway identity and the group
 * vanishes from their own list. Establishing the cookie on the document
 * response means every later request already carries it.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.get(COOKIE_NAME)) {
    return NextResponse.next();
  }

  const secret = randomSecret();
  // Make it visible to route handlers within this same request.
  request.cookies.set(COOKIE_NAME, secret);

  const response = NextResponse.next({ request });
  response.cookies.set(COOKIE_NAME, secret, {
    httpOnly: true,
    secure: isSecure(request),
    sameSite: "lax",
    path: "/",
    maxAge: TWO_YEARS,
  });
  return response;
}

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mirror of lib/session.ts: never mark the cookie Secure on a plain-http origin. */
function isSecure(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (proto) return proto === "https";
  return request.nextUrl.protocol === "https:";
}

export const config = {
  // Everything the user actually hits; static assets don't need an identity.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
