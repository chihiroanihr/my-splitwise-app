import { describe, it, expect } from "vitest";
import { computeBalances } from "@/lib/queries";
import { splitEqually } from "@/lib/split";
import type { GroupState, Expense, Member } from "@/lib/types";

let seq = 0;
const uid = () => `id${++seq}`;

function member(name: string): Member {
  return { id: uid(), groupId: "g", name, createdAt: 0 };
}

/** Build an expense whose splits are given as [member, share, status?] tuples. */
function expense(
  payer: Member,
  amount: number,
  splits: [Member, number, ("paid" | "unpaid")?][]
): Expense {
  const id = uid();
  return {
    id,
    groupId: "g",
    description: "x",
    amount,
    payerId: payer.id,
    createdAt: 0,
    revision: 0,
    splits: splits.map(([m, share, status]) => ({
      id: uid(),
      expenseId: id,
      memberId: m.id,
      shareAmount: share,
      // The payer's own share is settled by construction when unspecified.
      status: status ?? (m.id === payer.id ? "paid" : "unpaid"),
      paidAt: null,
    })),
  };
}

function state(members: Member[], expenses: Expense[]): GroupState {
  return {
    group: { id: "g", name: "g", createdAt: 0 },
    members,
    expenses,
    revision: 0,
    role: "owner",
    isAdmin: false,
  };
}

const netOf = (r: ReturnType<typeof computeBalances>, m: Member) =>
  r.balances.find((b) => b.memberId === m.id)!.net;

describe("computeBalances", () => {
  it("returns zeros when there are no expenses", () => {
    const [a, b] = [member("あゆみ"), member("けんた")];
    const r = computeBalances(state([a, b], []));
    expect(netOf(r, a)).toBe(0);
    expect(netOf(r, b)).toBe(0);
    expect(r.transfers).toEqual([]);
  });

  it("splits one expense equally across three people", () => {
    const [a, b, c] = [member("A"), member("B"), member("C")];
    const r = computeBalances(
      state([a, b, c], [expense(a, 9000, [[a, 3000], [b, 3000], [c, 3000]])])
    );
    expect(netOf(r, a)).toBe(6000);
    expect(netOf(r, b)).toBe(-3000);
    expect(netOf(r, c)).toBe(-3000);
  });

  it("nets two expenses with different payers", () => {
    const [a, b, c] = [member("A"), member("B"), member("C")];
    const r = computeBalances(
      state(
        [a, b, c],
        [
          expense(a, 9000, [[a, 3000], [b, 3000], [c, 3000]]),
          expense(b, 5000, [[a, 2000], [b, 1500], [c, 1500]]),
        ]
      )
    );
    expect(netOf(r, a)).toBe(4000);
    expect(netOf(r, b)).toBe(500);
    expect(netOf(r, c)).toBe(-4500);
  });

  it("ignores splits already marked paid", () => {
    const [a, b] = [member("A"), member("B")];
    const r = computeBalances(
      state([a, b], [expense(a, 6000, [[a, 3000], [b, 3000, "paid"]])])
    );
    expect(netOf(r, a)).toBe(0);
    expect(netOf(r, b)).toBe(0);
    expect(r.transfers).toEqual([]);
  });

  it("honours uneven custom shares", () => {
    const [a, b, c] = [member("A"), member("B"), member("C")];
    const r = computeBalances(
      state([a, b, c], [expense(a, 10000, [[a, 5000], [b, 3000], [c, 2000]])])
    );
    expect(netOf(r, a)).toBe(5000);
    expect(netOf(r, b)).toBe(-3000);
    expect(netOf(r, c)).toBe(-2000);
  });

  describe("settlement transfers", () => {
    it("always balances out to zero", () => {
      const [a, b, c, d] = [member("A"), member("B"), member("C"), member("D")];
      const r = computeBalances(
        state(
          [a, b, c, d],
          [
            expense(a, 12000, [[a, 3000], [b, 3000], [c, 3000], [d, 3000]]),
            expense(b, 8000, [[a, 2000], [b, 2000], [c, 2000], [d, 2000]]),
            expense(c, 4000, [[c, 2000], [d, 2000]]),
          ]
        )
      );
      const sum = r.balances.reduce((s, x) => s + x.net, 0);
      expect(sum).toBeCloseTo(0, 6);
    });

    it("moves exactly what each debtor owes and each creditor is due", () => {
      const [a, b, c] = [member("A"), member("B"), member("C")];
      const r = computeBalances(
        state(
          [a, b, c],
          [
            expense(a, 9000, [[a, 3000], [b, 3000], [c, 3000]]),
            expense(b, 5000, [[a, 2000], [b, 1500], [c, 1500]]),
          ]
        )
      );
      for (const bal of r.balances) {
        const out = r.transfers
          .filter((t) => t.fromMemberId === bal.memberId)
          .reduce((s, t) => s + t.amount, 0);
        const inn = r.transfers
          .filter((t) => t.toMemberId === bal.memberId)
          .reduce((s, t) => s + t.amount, 0);
        // Receiving minus paying must equal the member's net position.
        expect(inn - out).toBeCloseTo(bal.net, 6);
      }
    });

    it("needs at most (people - 1) transfers", () => {
      const people = [member("A"), member("B"), member("C"), member("D"), member("E")];
      const [a, b, c, d, e] = people;
      const r = computeBalances(
        state(
          people,
          [
            expense(a, 10000, people.map((m) => [m, 2000] as [Member, number])),
            expense(b, 5000, [[c, 2500], [d, 2500]]),
            expense(e, 3000, [[a, 1500], [b, 1500]]),
          ]
        )
      );
      expect(r.transfers.length).toBeLessThanOrEqual(people.length - 1);
    });

    it("never emits a self-transfer or a non-positive amount", () => {
      const [a, b, c] = [member("A"), member("B"), member("C")];
      const r = computeBalances(
        state(
          [a, b, c],
          [
            expense(a, 7000, [[a, 3500], [b, 3500]]),
            expense(c, 1000, [[a, 500], [c, 500]]),
          ]
        )
      );
      for (const t of r.transfers) {
        expect(t.fromMemberId).not.toBe(t.toMemberId);
        expect(t.amount).toBeGreaterThan(0);
      }
    });

    it("settles completely once every split is paid", () => {
      const [a, b, c] = [member("A"), member("B"), member("C")];
      const r = computeBalances(
        state(
          [a, b, c],
          [expense(a, 9000, [[a, 3000], [b, 3000, "paid"], [c, 3000, "paid"]])]
        )
      );
      expect(r.transfers).toEqual([]);
    });
  });

  it("balances exactly for amounts that do not divide evenly", () => {
    // ¥10,000 across 3 people. splitEqually is what the app actually stores, so
    // the balance column must reconcile to zero with no leftover sen.
    const [a, b, c] = [member("A"), member("B"), member("C")];
    const [sa, sb, sc] = splitEqually(10000, 3);
    const r = computeBalances(
      state([a, b, c], [expense(a, 10000, [[a, sa], [b, sb], [c, sc]])])
    );
    expect(netOf(r, a)).toBe(6666);
    expect(netOf(r, b)).toBe(-3333);
    expect(netOf(r, c)).toBe(-3333);
    expect(r.balances.reduce((s, x) => s + x.net, 0)).toBe(0);
  });

  it("counts a member who paid for others but owes nothing themselves", () => {
    const [a, b] = [member("A"), member("B")];
    // A covers B's meal entirely and is not part of the split.
    const r = computeBalances(state([a, b], [expense(a, 4000, [[b, 4000]])]));
    expect(netOf(r, a)).toBe(4000);
    expect(netOf(r, b)).toBe(-4000);
    expect(r.transfers).toEqual([
      { fromMemberId: b.id, toMemberId: a.id, amount: 4000 },
    ]);
  });
});
