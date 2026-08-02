export type Role = "owner" | "member";

export type Group = {
  id: string;
  name: string;
  createdAt: number;
  /** Only ever sent to users who already have access to the group. */
  inviteToken?: string;
  /** The requesting user's role in this group. */
  role?: Role;
};

export type Session = {
  userId: string;
  isAdmin: boolean;
};

/** A device that can open a group — distinct from a Member, who is just a name. */
export type Participant = {
  userId: string;
  role: Role;
  joinedAt: number;
  /** Set on the entry belonging to the requesting device. */
  isYou?: boolean;
};

export type Member = {
  id: string;
  groupId: string;
  name: string;
  createdAt: number;
};

export type Expense = {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  payerId: string;
  createdAt: number;
  splits: ExpenseSplit[];
};

export type ExpenseSplit = {
  id: string;
  expenseId: string;
  memberId: string;
  shareAmount: number;
  status: "unpaid" | "paid";
  paidAt: number | null;
};

export type GroupState = {
  group: Group;
  members: Member[];
  expenses: Expense[];
  revision: number;
  /** The requesting user's role, plus whether they hold the admin flag. */
  role: Role;
  isAdmin: boolean;
};

export type Balance = {
  memberId: string;
  net: number;
};

export type Transfer = {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
};
