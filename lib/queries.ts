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
} from "./types";

// Postgres BIGINT comes back as a string from the driver (to avoid precision loss),
// so timestamps need an explicit conversion back to number.
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

type GroupRow = { id: string; name: string; created_at: string; revision: number };
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

export async function listGroups(): Promise<Group[]> {
  const sql = await db();
  const rows = (await sql`
    SELECT * FROM groups ORDER BY created_at DESC
  `) as GroupRow[];
  return rows.map(toGroup);
}

export async function createGroup(name: string): Promise<Group> {
  const sql = await db();
  const id = nanoid(10);
  const now = Date.now();
  await sql`
    INSERT INTO groups (id, name, created_at, revision)
    VALUES (${id}, ${name}, ${now}, 0)
  `;
  return { id, name, createdAt: now };
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  const sql = await db();
  await sql`UPDATE groups SET name = ${name} WHERE id = ${groupId}`;
}

export async function deleteGroup(groupId: string): Promise<void> {
  const sql = await db();
  await sql`DELETE FROM groups WHERE id = ${groupId}`;
}

export async function getGroupState(groupId: string): Promise<GroupState | null> {
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
    group: toGroup(groupRow),
    members: memberRows.map(toMember),
    expenses,
    revision: groupRow.revision,
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

  await sql.transaction([
    sql`
      UPDATE expenses
      SET description = ${args.description}, amount = ${args.amount}, payer_id = ${args.payerId}
      WHERE id = ${args.expenseId} AND group_id = ${args.groupId}
    `,
    sql`DELETE FROM expense_splits WHERE expense_id = ${args.expenseId}`,
    ...args.splits.map((s) => {
      const isPayer = s.memberId === args.payerId;
      return sql`
        INSERT INTO expense_splits (id, expense_id, member_id, share_amount, status, paid_at)
        VALUES (
          ${nanoid(10)}, ${args.expenseId}, ${s.memberId}, ${s.shareAmount},
          ${isPayer ? "paid" : "unpaid"}, ${isPayer ? now : null}
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
