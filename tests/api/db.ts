import { neon } from "@neondatabase/serverless";

/**
 * Direct read access to the test database.
 *
 * Some invariants are invisible over HTTP — "browsing must not write a row"
 * can only be checked by counting rows. Never point this at production: the
 * harness sets TEST_DATABASE_URL, and there is no fallback on purpose.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set for the test run");

export const testDb = neon(url);

export async function countUsers(): Promise<number> {
  const rows = (await testDb`SELECT count(*)::int AS n FROM app_users`) as {
    n: number;
  }[];
  return rows[0].n;
}
