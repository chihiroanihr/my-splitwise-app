import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

let _sql: Sql | null = null;

/** Lazily create the Neon client so `next build` doesn't crash when DATABASE_URL is unset. */
export function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Add it to .env.local (local) or the Vercel project env (production)."
      );
    }
    _sql = neon(url);
  }
  return _sql;
}

let schemaReady: Promise<void> | null = null;

/**
 * Create tables on first use. Idempotent (CREATE TABLE IF NOT EXISTS) and cached
 * per serverless instance, so this costs one round trip per cold start at most.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema().catch((err) => {
      schemaReady = null; // let the next request retry instead of caching the failure
      throw err;
    });
  }
  return schemaReady;
}

async function createSchema(): Promise<void> {
  const sql = getSql();
  await sql.transaction([
    sql`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        invite_token TEXT
      )
    `,
    // Older rows predate invite_token; give them one so every group is shareable.
    sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_token TEXT`,
    sql`UPDATE groups SET invite_token = md5(random()::text || id) WHERE invite_token IS NULL`,
    // Anonymous per-device identity. `id` is the SHA-256 of the value held in the
    // user's cookie, so a database leak alone can't be replayed as a session.
    sql`
      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        created_at BIGINT NOT NULL,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE
      )
    `,
    // Who may open which group, and with what authority.
    sql`
      CREATE TABLE IF NOT EXISTS group_access (
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
        joined_at BIGINT NOT NULL,
        PRIMARY KEY (group_id, user_id)
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS idx_access_user ON group_access(user_id)`,
    sql`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id)`,
    sql`
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        payer_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      )
    `,
    // Per-expense version, used to reject an edit written against stale data.
    // The group-level revision is too coarse: it moves whenever anyone touches
    // anything, which would flag conflicts that aren't.
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0`,
    sql`CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id)`,
    sql`
      CREATE TABLE IF NOT EXISTS expense_splits (
        id TEXT PRIMARY KEY,
        expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        share_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('paid', 'unpaid')),
        paid_at BIGINT
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS idx_splits_expense ON expense_splits(expense_id)`,
  ]);
}

/** Get a ready-to-use client, creating the schema on first call. */
export async function db(): Promise<NeonQueryFunction<false, false>> {
  await ensureSchema();
  return getSql();
}
