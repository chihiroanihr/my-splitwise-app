#!/usr/bin/env node
/**
 * Inspect and tidy the identity tables.
 *
 * Two things accumulate: anonymous `app_users` rows belonging to devices that
 * never joined a group, and admin flags granted to devices whose cookie is long
 * gone (test runs, a phone that was wiped). Neither is reachable, but leaving
 * unaccounted-for admin identities in a database is not a state worth keeping.
 *
 *   node scripts/db-maintenance.mjs                    # report only
 *   node scripts/db-maintenance.mjs --revoke-admins --yes
 *   node scripts/db-maintenance.mjs --prune-orphans --yes
 *
 * Defaults to a dry run: nothing is written unless --yes is passed.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env.test.local"]) {
  if (existsSync(file)) config({ path: file, quiet: true });
}

const argv = process.argv.slice(2);
const args = new Set(argv);
const apply = args.has("--yes");
const revokeAdmins = args.has("--revoke-admins");
const pruneOrphans = args.has("--prune-orphans");
const useTestDb = args.has("--test-db");

// How old an orphan must be before it is considered abandoned. The default
// protects someone who is on the site right now but has not joined anything
// yet; pass 0 when clearing rows you know the origin of.
const graceArg = argv.find((a) => a.startsWith("--grace-hours="));
const graceHours = graceArg ? Number(graceArg.split("=")[1]) : 24;
if (!Number.isFinite(graceHours) || graceHours < 0) {
  console.error("--grace-hours must be a non-negative number");
  process.exit(1);
}

const url = useTestDb ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error(`${useTestDb ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set.`);
  process.exit(1);
}
const sql = neon(url);

// Orphans are devices with no group membership at all.
const cutoff = Date.now() - graceHours * 60 * 60 * 1000;

async function report() {
  const [row] = await sql`
    SELECT
      (SELECT count(*) FROM app_users) AS users,
      (SELECT count(*) FROM app_users WHERE is_admin) AS admins,
      (SELECT count(*) FROM app_users u
        WHERE NOT EXISTS (SELECT 1 FROM group_access a WHERE a.user_id = u.id)
          AND u.created_at < ${cutoff}) AS prunable,
      (SELECT count(*) FROM groups) AS groups,
      (SELECT count(*) FROM group_access) AS memberships,
      (SELECT count(*) FROM expenses) AS expenses
  `;
  console.log(`  app_users        ${row.users}`);
  console.log(`   ├ admin flags   ${row.admins}`);
  console.log(`   └ prunable      ${row.prunable}  (no group, older than ${graceHours}h)`);
  console.log(`  groups           ${row.groups}`);
  console.log(`  memberships      ${row.memberships}`);
  console.log(`  expenses         ${row.expenses}`);
  return row;
}

console.log(`\nDatabase: ${useTestDb ? "TEST" : "PRODUCTION"}\n`);
console.log("Before:");
await report();

if (!revokeAdmins && !pruneOrphans) {
  console.log("\nNothing requested. Pass --revoke-admins and/or --prune-orphans.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run — pass --yes to apply.");
  process.exit(0);
}

console.log("");
if (revokeAdmins) {
  const rows = await sql`UPDATE app_users SET is_admin = FALSE WHERE is_admin RETURNING id`;
  console.log(`  revoked ${rows.length} admin flag(s)`);
  console.log("  → re-grant on your own device at /admin");
}
if (pruneOrphans) {
  const rows = await sql`
    DELETE FROM app_users u
    WHERE NOT EXISTS (SELECT 1 FROM group_access a WHERE a.user_id = u.id)
      AND u.created_at < ${cutoff}
    RETURNING id
  `;
  console.log(`  pruned ${rows.length} orphaned user row(s)`);
}

console.log("\nAfter:");
await report();
console.log("");
