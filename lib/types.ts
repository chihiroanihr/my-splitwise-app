export type Group = {
  id: string;
  name: string;
  createdAt: number;
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
