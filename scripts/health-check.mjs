#!/usr/bin/env node
/**
 * Read-only liveness check for the deployed app.
 *
 * Deliberately performs no writes: this runs on a schedule against production,
 * and a monitor that creates data is a monitor that eventually leaves junk (or
 * deletes the wrong thing). Hitting /api/groups is enough to prove the database
 * is awake, because that route queries it on every request.
 */
const BASE = process.env.HEALTH_URL ?? "https://my-splitwise-app.vercel.app";

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

async function get(path) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  return { res, ms: Date.now() - started };
}

check("home page responds", async () => {
  const { res, ms } = await get("/");
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const html = await res.text();
  if (!html.includes("精算アプリ")) throw new Error("page body missing app title");
  return `${ms}ms`;
});

check("database is reachable", async () => {
  const { res, ms } = await get("/api/groups");
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body.groups)) throw new Error("unexpected payload shape");
  return `${ms}ms (Neon may need a moment to wake)`;
});

check("session cookie is issued", async () => {
  const { res } = await get("/");
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie().join("; ")
      : res.headers.get("set-cookie") ?? "";
  if (!raw.includes("seisan_uid")) throw new Error("no identity cookie set");
  if (!/secure/i.test(raw)) throw new Error("cookie is not marked Secure over https");
  if (!/httponly/i.test(raw)) throw new Error("cookie is not HttpOnly");
  return "httpOnly + secure";
});

check("a stranger cannot read an unknown group", async () => {
  const { res } = await get("/api/groups/definitelynotreal");
  if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  return "403 as expected";
});

check("admin endpoint refuses an empty key", async () => {
  const res = await fetch(`${BASE}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: "" }),
    signal: AbortSignal.timeout(30_000),
  });
  // 429 also means refused — repeated runs can trip the failure throttle.
  if (res.status !== 403 && res.status !== 429) {
    throw new Error(`expected 403 or 429, got ${res.status}`);
  }
  return `${res.status} as expected`;
});

console.log(`Health check → ${BASE}\n`);

let failed = 0;
for (const { name, fn } of checks) {
  try {
    const detail = await fn();
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name} — ${err.message ?? err}`);
  }
}

console.log(
  failed === 0
    ? `\nAll ${checks.length} checks passed.`
    : `\n${failed} of ${checks.length} checks FAILED.`
);
process.exit(failed === 0 ? 0 : 1);
