import { nanoid } from "nanoid";
import { db } from "./db";
import type {
  Group,
  Member,
  Expense,
  ExpenseSplit,
  GroupState,
  Balance,
  Transfer,
  Role,
  Session,
  Participant,
} from "./types";

// Postgres BIGINT comes back as a string from the driver (to avoid precision loss),
// so timestamps need an explicit conversion back to number.
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

type GroupRow = {
  id: string;
  name: string;
  created_at: string;
  revision: number;
  invite_token: string;
};
type MemberRow = { id: string; group_id: string; name: string; created_at: string };
type ExpenseRow = {
  id: string;
  group_id: string;
  description: string;
  amount: number;
  payer_id: string;
  created_at: string;
};
type SplitRow = {
  id: string;
  expense_id: string;
  member_id: string;
  share_amount: number;
  status: "paid" | "unpaid";
  paid_at: string | null;
};

const toGroup = (r: GroupRow): Group => ({
  id: r.id,
  name: r.name,
  createdAt: num(r.created_at),
});
const toMember = (r: MemberRow): Member => ({
  id: r.id,
  groupId: r.group_id,
  name: r.name,
  createdAt: num(r.created_at),
});
const toSplit = (r: SplitRow): ExpenseSplit => ({
  id: r.id,
  expenseId: r.expense_id,
  memberId: r.member_id,
  shareAmount: r.share_amount,
  status: r.status,
  paidAt: r.paid_at === null ? null : num(r.paid_at),
});

/**
 * Look up (or lazily create) the anonymous user behind a cookie.
 * `userKey` is already a SHA-256 digest of the cookie value.
 */
export async function ensureUser(userKey: string): Promise<Session> {
  const sql = await db();
  const rows = (await sql`
    INSERT INTO app_users (id, created_at)
    VALUES (${userKey}, ${Date.now()})
    ON CONFLICT (id) DO UPDATE SET id = app_users.id
    RETURNING id, is_admin
  `) as { id: string; is_admin: boolean }[];
  return { userId: rows[0].id, isAdmin: rows[0].is_admin };
}

/** Grant the admin flag to a user. Guarded by ADMIN_KEY at the route level. */
export async function grantAdmin(userId: string): Promise<void> {
  const sql = await db();
  await sql`UPDATE app_users SET is_admin = TRUE WHERE id = ${userId}`;
}

/** The user's role in a group, or null when they have no access at all. */
export async function getRole(groupId: string, userId: string): Promise<Role | null> {
  const sql = await db();
  const rows = (await sql`
    SELECT role FROM group_access WHERE group_id = ${groupId} AND user_id = ${userId}
  `) as { role: Role }[];
  return rows[0]?.role ?? null;
}

/** Only the groups this user belongs to. Admins see everything. */
export async function listGroupsForUser(session: Session): Promise<Group[]> {
  const sql = await db();
  const rows = (await (session.isAdmin
    ? sql`
        SELECT g.*, COALESCE(a.role, 'member') AS role
        FROM groups g
        LEFT JOIN group_access a ON a.group_id = g.id AND a.user_id = ${session.userId}
        ORDER BY g.created_at DESC
      `
    : sql`
        SELECT g.*, a.role AS role
        FROM groups g
        JOIN group_access a ON a.group_id = g.id
        WHERE a.user_id = ${session.userId}
        ORDER BY g.created_at DESC
      `)) as (GroupRow & { role: Role })[];
  return rows.map((r) => ({ ...toGroup(r), role: r.role }));
}

export async function createGroup(name: string, userId: string): Promise<Group> {
  const sql = await db();
  const id = nanoid(10);
  const inviteToken = nanoid(24);
  const now = Date.now();
  await sql.transaction([
    sql`
      INSERT INTO groups (id, name, created_at, revision, invite_token)
      VALUES (${id}, ${name}, ${now}, 0, ${inviteToken})
    `,
    sql`
      INSERT INTO group_access (group_id, user_id, role, joined_at)
      VALUES (${id}, ${userId}, 'owner', ${now})
    `,
  ]);
  return { id, name, createdAt: now, inviteToken, role: "owner" };
}

/**
 * Issue a fresh invite token, invalidating every link handed out so far.
 * The only way to shut out someone the link was forwarded to.
 */
export async function rotateInviteToken(groupId: string): Promise<string> {
  const sql = await db();
  const token = nanoid(24);
  await sql.transaction([
    sql`UPDATE groups SET invite_token = ${token} WHERE id = ${groupId}`,
    sql`UPDATE groups SET revision = revision + 1 WHERE id = ${groupId}`,
  ]);
  return token;
}

/** Everyone who can currently open this group, oldest first. */
export async function listParticipants(groupId: string): Promise<Participant[]> {
  const sql = await db();
  const rows = (await sql`
    SELECT user_id, role, joined_at
    FROM group_access
    WHERE group_id = ${groupId}
    ORDER BY joined_at ASC
  `) as { user_id: string; role: Role; joined_at: string }[];
  return rows.map((r) => ({
    userId: r.user_id,
    role: r.role,
    joinedAt: num(r.joined_at),
  }));
}

/**
 * Revoke a participant's access. Owners cannot be removed — a group without an
 * owner would have nobody able to delete or rename it.
 */
export async function removeParticipant(
  groupId: string,
  userId: string
): Promise<boolean> {
  const sql = await db();
  const rows = (await sql`
    DELETE FROM group_access
    WHERE group_id = ${groupId} AND user_id = ${userId} AND role <> 'owner'
    RETURNING user_id
  `) as { user_id: string }[];
  if (rows.length === 0) return false;
  await sql`UPDATE groups SET revision = revision + 1 WHERE id = ${groupId}`;
  return true;
}

/**
 * Add the user to a group if they present the correct invite token.
 * Existing members are left untouched (their role is preserved).
 */
export async function joinGroup(
  groupId: string,
  token: string,
  userId: string
): Promise<boolean> {
  const sql = await db();
  const rows = (await sql`
    SELECT invite_token FROM groups WHERE id = ${groupId}
  `) as { invite_token: string }[];
  const expected = rows[0]?.invite_token;
  // Reject unknown groups and groups whose token has not been set.
  if (!expected || !token || token !== expected) return false;
  await sql`
    INSERT INTO group_access (group_id, user_id, role, joined_at)
    VALUES (${groupId}, ${userId}, 'member', ${Date.now()})
    ON CONFLICT (group_id, user_id) DO NOTHING
  `;
  return true;
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  const sql = await db();
  await sql`UPDATE groups SET name = ${name} WHERE id = ${groupId}`;
}

export async function deleteGroup(groupId: string): Promise<void> {
  const sql = await db();
  await sql`DELETE FROM groups WHERE id = ${groupId}`;
}

export async function getGroupState(
  groupId: string,
  viewer: { role: Role; isAdmin: boolean }
): Promise<GroupState | null> {
  const sql = await db();

  // One HTTP round trip for all four reads, from a single consistent snapshot.
  const [groupRows, memberRows, expenseRows, splitRows] = (await sql.transaction([
    sql`SELECT * FROM groups WHERE id = ${groupId}`,
    sql`SELECT * FROM members WHERE group_id = ${groupId} ORDER BY created_at ASC`,
    sql`SELECT * FROM expenses WHERE group_id = ${groupId} ORDER BY created_at DESC`,
    sql`
      SELECT s.* FROM expense_splits s
      JOIN expenses e ON e.id = s.expense_id
      WHERE e.group_id = ${groupId}
    `,
  ])) as [GroupRow[], MemberRow[], ExpenseRow[], SplitRow[]];

  const groupRow = groupRows[0];
  if (!groupRow) return null;

  const splitsByExpense = new Map<string, ExpenseSplit[]>();
  for (const r of splitRows) {
    const list = splitsByExpense.get(r.expense_id) ?? [];
    list.push(toSplit(r));
    splitsByExpense.set(r.expense_id, list);
  }

  const expenses: Expense[] = expenseRows.map((r) => ({
    id: r.id,
    groupId: r.group_id,
    description: r.description,
    amount: r.amount,
    payerId: r.payer_id,
    createdAt: num(r.created_at),
    splits: splitsByExpense.get(r.id) ?? [],
  }));

  return {
    // The invite token is a capability: only hand it to someone already inside.
    group: { ...toGroup(groupRow), inviteToken: groupRow.invite_token, role: viewer.role },
    members: memberRows.map(toMember),
    expenses,
    revision: groupRow.revision,
    role: viewer.role,
    isAdmin: viewer.isAdmin,
  };
}

export async function addMember(groupId: string, name: string): Promise<Member> {
  const sql = await db();
  const id = nanoid(10);
  const now = Date.now();
  await sql.transaction([
    sql`
      INSERT INTO members (id, group_id, name, created_at)
      VALUES (${id}, ${groupId}, ${name}, ${now})
    `,
    sql`UPDATE groups SET revision = revision + 1 WHERE id = ${groupId}`,
  ]);
  return { id, groupId, name, createdAt: now };
}

export async function deleteMember(groupId: string, memberId: string): Promise<void> {
  const sql = await db();
  await sql.transaction([
    sql`DELETE FROM members WHERE id = ${memberId} AND group_id = ${groupId}`,
    sql`UPDATE groups SET revision = revision + 1 WHERE id = ${groupId}`,
  ]);
}

export async function addExpense(args: {
  groupId: string;
  description: string;
  amount: number;
  payerId: string;
  splits: { memberId: string; shareAmount: number }[];
}): Promise<Expense> {
  const sql = await db();
  const id = nanoid(10);
  const now = Date.now();

  const created: ExpenseSplit[] = args.splits.map((s) => {
    const isPayer = s.memberId === args.payerId;
    return {
      id: nanoid(10),
      expenseId: id,
      memberId: s.memberId,
      shareAmount: s.shareAmount,
      status: isPayer ? "paid" : "unpaid",
      paidAt: isPayer ? now : null,
    };
  });

  await sql.transaction([
    sql`
      INSERT INTO expenses (id, group_id, description, amount, payer_id, created_at)
      VALUES (${id}, ${args.groupId}, ${args.description}, ${args.amount}, ${args.payerId}, ${now})
    `,
    ...created.map(
      (s) => sql`
        INSERT INTO expense_splits (id, expense_id, member_id, share_amount, status, paid_at)
        VALUES (${s.id}, ${s.expenseId}, ${s.memberId}, ${s.shareAmount}, ${s.status}, ${s.paidAt})
      `
    ),
    sql`UPDATE groups SET revision = revision + 1 WHERE id = ${args.groupId}`,
  ]);

  return {
    id,
    groupId: args.groupId,
    description: args.description,
    amount: args.amount,
    payerId: args.payerId,
    createdAt: now,
    splits: created,
  };
}

export async function updateExpense(args: {
  groupId: string;
  expenseId: string;
  description: string;
  amount: number;
  payerId: string;
  splits: { memberId: string; shareAmount: number }[];
}): Promise<void> {
  const sql = await db();
  const now = Date.now();

  // Splits are rebuilt from scratch, so read the current ones first and carry
  // over anything already settled. Without this, correcting a typo would wipe
  // every "精算済み" tick in the expense. A member whose share *changed* is
  // reset, because what they owe is no longer the amount they settled.
  const previous = (await sql`
    SELECT s.member_id, s.share_amount, s.status, s.paid_at
    FROM expense_splits s
    JOIN expenses e ON e.id = s.expense_id
    WHERE s.expense_id = ${args.expenseId} AND e.group_id = ${args.groupId}
  `) as {
    member_id: string;
    share_amount: number;
    status: "paid" | "unpaid";
    paid_at: string | null;
  }[];
  const before = new Map(previous.map((r) => [r.member_id, r]));

  await sql.transaction([
    sql`
      UPDATE expenses
      SET description = ${args.description}, amount = ${args.amount}, payer_id = ${args.payerId}
      WHERE id = ${args.expenseId} AND group_id = ${args.groupId}
    `,
    sql`DELETE FROM expense_splits WHERE expense_id = ${args.expenseId}`,
    ...args.splits.map((s) => {
      const isPayer = s.memberId === args.payerId;
      const prior = before.get(s.memberId);
      const keepPaid =
        !isPayer &&
        prior?.status === "paid" &&
        prior.share_amount === s.shareAmount;

      const status = isPayer || keepPaid ? "paid" : "unpaid";
      const paidAt = isPayer
        ? now
        : keepPaid
        ? // Keep the original timestamp; fall back if the row somehow lacked one.
          prior!.paid_at === null
          ? now
          : num(prior!.paid_at)
        : null;

      return sql`
        INSERT INTO expense_splits (id, expense_id, member_id, share_amount, status, paid_at)
        VALUES (
          ${nanoid(10)}, ${args.expenseId}, ${s.memberId}, ${s.shareAmount},
          ${status}, ${paidAt}
        )
      `;
    }),
    sql`UPDATE groups SET revision = revision + 1 WHERE id = ${args.groupId}`,
  ]);
}

export async function deleteExpense(groupId: string, expenseId: string): Promise<void> {
  const sql = await db();
  await sql.transaction([
    sql`DELETE FROM expenses WHERE id = ${expenseId} AND group_id = ${groupId}`,
    sql`UPDATE groups SET revision = revision + 1 WHERE id = ${groupId}`,
  ]);
}

export async function setSplitStatus(args: {
  groupId: string;
  splitId: string;
  status: "paid" | "unpaid";
}): Promise<void> {
  const sql = await db();
  const paidAt = args.status === "paid" ? Date.now() : null;
  await sql.transaction([
    sql`
      UPDATE expense_splits SET status = ${args.status}, paid_at = ${paidAt}
      WHERE id = ${args.splitId}
      AND expense_id IN (SELECT id FROM expenses WHERE group_id = ${args.groupId})
    `,
    sql`UPDATE groups SET revision = revision + 1 WHERE id = ${args.groupId}`,
  ]);
}

// Compute net balance per member, then minimal-transfer settlement.
// Net is the sum of outstanding amounts owed to (positive) or by (negative) each member.
export function computeBalances(state: GroupState): {
  balances: Balance[];
  transfers: Transfer[];
} {
  const net = new Map<string, number>();
  for (const m of state.members) net.set(m.id, 0);

  for (const exp of state.expenses) {
    for (const s of exp.splits) {
      if (s.status === "paid") continue;
      net.set(s.memberId, (net.get(s.memberId) ?? 0) - s.shareAmount);
      net.set(exp.payerId, (net.get(exp.payerId) ?? 0) + s.shareAmount);
    }
  }

  const balances: Balance[] = state.members.map((m) => ({
    memberId: m.id,
    net: round2(net.get(m.id) ?? 0),
  }));

  // Greedy minimal-transfer suggestion among current outstanding nets.
  const debtors = balances
    .filter((b) => b.net < -0.005)
    .map((b) => ({ id: b.memberId, amount: -b.net }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((b) => b.net > 0.005)
    .map((b) => ({ id: b.memberId, amount: b.net }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amt = Math.min(d.amount, c.amount);
    if (amt > 0.005) {
      transfers.push({
        fromMemberId: d.id,
        toMemberId: c.id,
        amount: round2(amt),
      });
    }
    d.amount -= amt;
    c.amount -= amt;
    if (d.amount < 0.005) i++;
    if (c.amount < 0.005) j++;
  }

  return { balances, transfers };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
