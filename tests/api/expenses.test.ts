import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client, adminClient, createGroup, addMember } from "./client";

describe("expenses, settlement and deletion", () => {
  let user: Client;
  let admin: Client;
  let groupId: string;
  let A: string, B: string, C: string;
  const created: string[] = [];

  const state = async () => (await user.get(`/api/groups/${groupId}`)).data;
  const netOf = (s: any, id: string) =>
    s.balances.find((b: any) => b.memberId === id).net;

  beforeAll(async () => {
    user = new Client();
    admin = await adminClient();
  });

  afterAll(async () => {
    for (const id of created) await admin.delete(`/api/groups/${id}`);
  });

  beforeEach(async () => {
    const g = await createGroup(user, "テスト");
    groupId = g.id;
    created.push(g.id);
    A = await addMember(user, groupId, "あゆみ");
    B = await addMember(user, groupId, "けんた");
    C = await addMember(user, groupId, "さくら");
  });

  describe("creating expenses", () => {
    it("marks the payer as already settled and everyone else as unpaid", async () => {
      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "ホテル",
        amount: 9000,
        payerId: A,
        participantIds: [A, B, C],
      });
      const s = await state();
      const splits = s.expenses[0].splits;
      expect(splits.find((x: any) => x.memberId === A).status).toBe("paid");
      expect(splits.find((x: any) => x.memberId === B).status).toBe("unpaid");
      expect(splits.find((x: any) => x.memberId === C).status).toBe("unpaid");
    });

    it("splits an indivisible amount into whole yen that sum exactly", async () => {
      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "割り切れない",
        amount: 10000,
        payerId: A,
        participantIds: [A, B, C],
      });
      const s = await state();
      const shares = s.expenses[0].splits.map((x: any) => x.shareAmount);
      expect(shares.reduce((a: number, b: number) => a + b, 0)).toBe(10000);
      for (const v of shares) expect(Number.isInteger(v)).toBe(true);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    });

    it("accepts explicit uneven shares", async () => {
      const res = await user.post(`/api/groups/${groupId}/expenses`, {
        description: "居酒屋",
        amount: 5000,
        payerId: B,
        splits: [
          { memberId: A, shareAmount: 2000 },
          { memberId: B, shareAmount: 1500 },
          { memberId: C, shareAmount: 1500 },
        ],
      });
      expect(res.status).toBe(201);
    });

    it.each([
      ["shares that do not add up", { amount: 1000, splits: [{ shareAmount: 100 }] }],
      ["a zero amount", { amount: 0, splits: [{ shareAmount: 0 }] }],
      ["a negative amount", { amount: -500, splits: [{ shareAmount: -500 }] }],
    ])("rejects %s", async (_label, { amount, splits }) => {
      const res = await user.post(`/api/groups/${groupId}/expenses`, {
        description: "ng",
        amount,
        payerId: A,
        splits: splits.map((s) => ({ memberId: A, shareAmount: s.shareAmount })),
      });
      expect(res.status).toBe(400);
    });

    it("rejects an empty description", async () => {
      const res = await user.post(`/api/groups/${groupId}/expenses`, {
        description: "   ",
        amount: 1000,
        payerId: A,
        participantIds: [A],
      });
      expect(res.status).toBe(400);
    });

    it("rejects an expense with nobody to split between", async () => {
      const res = await user.post(`/api/groups/${groupId}/expenses`, {
        description: "誰もいない",
        amount: 1000,
        payerId: A,
        splits: [],
      });
      expect(res.status).toBe(400);
    });
  });

  describe("settlement maths", () => {
    beforeEach(async () => {
      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "ホテル",
        amount: 9000,
        payerId: A,
        participantIds: [A, B, C],
      });
      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "居酒屋",
        amount: 5000,
        payerId: B,
        splits: [
          { memberId: A, shareAmount: 2000 },
          { memberId: B, shareAmount: 1500 },
          { memberId: C, shareAmount: 1500 },
        ],
      });
    });

    it("computes each member's net position", async () => {
      const s = await state();
      expect(netOf(s, A)).toBe(4000);
      expect(netOf(s, B)).toBe(500);
      expect(netOf(s, C)).toBe(-4500);
    });

    it("always balances to zero", async () => {
      const s = await state();
      expect(s.balances.reduce((t: number, b: any) => t + b.net, 0)).toBe(0);
    });

    it("suggests no more transfers than members minus one", async () => {
      const s = await state();
      expect(s.transfers.length).toBeLessThanOrEqual(s.members.length - 1);
    });

    it("recomputes when a split is marked paid", async () => {
      const s = await state();
      const hotel = s.expenses.find((e: any) => e.description === "ホテル");
      const split = hotel.splits.find((x: any) => x.memberId === B);

      await user.patch(`/api/groups/${groupId}/splits/${split.id}`, { status: "paid" });

      const after = await state();
      expect(netOf(after, A)).toBe(1000);
      expect(netOf(after, B)).toBe(3500);
      expect(after.balances.reduce((t: number, b: any) => t + b.net, 0)).toBe(0);
    });

    it("can be toggled back to unpaid", async () => {
      const s = await state();
      const split = s.expenses[0].splits.find((x: any) => x.status === "unpaid");
      await user.patch(`/api/groups/${groupId}/splits/${split.id}`, { status: "paid" });
      await user.patch(`/api/groups/${groupId}/splits/${split.id}`, { status: "unpaid" });
      const after = await state();
      expect(netOf(after, A)).toBe(netOf(s, A));
    });

    it("clears all transfers once everything is settled", async () => {
      const s = await state();
      for (const e of s.expenses) {
        for (const sp of e.splits) {
          if (sp.status === "unpaid") {
            await user.patch(`/api/groups/${groupId}/splits/${sp.id}`, { status: "paid" });
          }
        }
      }
      const after = await state();
      expect(after.transfers).toEqual([]);
      expect(after.balances.every((b: any) => b.net === 0)).toBe(true);
    });

    it("rejects an invalid status value", async () => {
      const s = await state();
      const split = s.expenses[0].splits[0];
      const res = await user.patch(`/api/groups/${groupId}/splits/${split.id}`, {
        status: "maybe",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("editing an expense", () => {
    it("replaces amount and shares", async () => {
      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "ホテル",
        amount: 9000,
        payerId: A,
        participantIds: [A, B, C],
      });
      const before = await state();
      const id = before.expenses[0].id;

      await user.patch(`/api/groups/${groupId}/expenses/${id}`, {
        description: "ホテル(修正)",
        amount: 12000,
        payerId: A,
        splits: [
          { memberId: A, shareAmount: 4000 },
          { memberId: B, shareAmount: 4000 },
          { memberId: C, shareAmount: 4000 },
        ],
      });

      const after = await state();
      expect(after.expenses[0].description).toBe("ホテル(修正)");
      expect(after.expenses[0].amount).toBe(12000);
      expect(netOf(after, A)).toBe(8000);
    });

    describe("settled ticks survive an edit", () => {
      // Rebuilding the splits used to reset every "精算済み" tick, so fixing a
      // typo forced everyone to re-confirm they had paid.
      let expenseId: string;

      beforeEach(async () => {
        await user.post(`/api/groups/${groupId}/expenses`, {
          description: "ホテル",
          amount: 9000,
          payerId: A,
          participantIds: [A, B, C],
        });
        const s = await state();
        expenseId = s.expenses[0].id;
        const bSplit = s.expenses[0].splits.find((x: any) => x.memberId === B);
        await user.patch(`/api/groups/${groupId}/splits/${bSplit.id}`, {
          status: "paid",
        });
      });

      const statusOf = async (memberId: string) => {
        const s = await state();
        return s.expenses[0].splits.find((x: any) => x.memberId === memberId).status;
      };

      it("keeps it when only the description changes", async () => {
        await user.patch(`/api/groups/${groupId}/expenses/${expenseId}`, {
          description: "ホテル(名称修正)",
          amount: 9000,
          payerId: A,
          splits: [
            { memberId: A, shareAmount: 3000 },
            { memberId: B, shareAmount: 3000 },
            { memberId: C, shareAmount: 3000 },
          ],
        });
        expect(await statusOf(B)).toBe("paid");
        expect(await statusOf(C)).toBe("unpaid");
      });

      it("keeps the original paid timestamp", async () => {
        const before = await state();
        const paidAt = before.expenses[0].splits.find(
          (x: any) => x.memberId === B
        ).paidAt;

        await user.patch(`/api/groups/${groupId}/expenses/${expenseId}`, {
          description: "ホテル(修正)",
          amount: 9000,
          payerId: A,
          splits: [
            { memberId: A, shareAmount: 3000 },
            { memberId: B, shareAmount: 3000 },
            { memberId: C, shareAmount: 3000 },
          ],
        });

        const after = await state();
        expect(
          after.expenses[0].splits.find((x: any) => x.memberId === B).paidAt
        ).toBe(paidAt);
      });

      it("keeps it for members whose share is unchanged when someone else's moves", async () => {
        await user.patch(`/api/groups/${groupId}/expenses/${expenseId}`, {
          description: "ホテル",
          amount: 10000,
          payerId: A,
          splits: [
            { memberId: A, shareAmount: 4000 },
            { memberId: B, shareAmount: 3000 },
            { memberId: C, shareAmount: 3000 },
          ],
        });
        expect(await statusOf(B)).toBe("paid");
      });

      it("resets it when that member's own share changes", async () => {
        await user.patch(`/api/groups/${groupId}/expenses/${expenseId}`, {
          description: "ホテル",
          amount: 12000,
          payerId: A,
          splits: [
            { memberId: A, shareAmount: 4000 },
            { memberId: B, shareAmount: 4000 },
            { memberId: C, shareAmount: 4000 },
          ],
        });
        // B settled ¥3,000 but now owes ¥4,000, so the tick can't stand.
        expect(await statusOf(B)).toBe("unpaid");
      });

      it("does not resurrect a tick after the member is dropped and re-added", async () => {
        await user.patch(`/api/groups/${groupId}/expenses/${expenseId}`, {
          description: "ホテル",
          amount: 6000,
          payerId: A,
          splits: [
            { memberId: A, shareAmount: 3000 },
            { memberId: C, shareAmount: 3000 },
          ],
        });
        await user.patch(`/api/groups/${groupId}/expenses/${expenseId}`, {
          description: "ホテル",
          amount: 9000,
          payerId: A,
          splits: [
            { memberId: A, shareAmount: 3000 },
            { memberId: B, shareAmount: 3000 },
            { memberId: C, shareAmount: 3000 },
          ],
        });
        expect(await statusOf(B)).toBe("unpaid");
      });

      it("keeps other members settled when the payer changes", async () => {
        await user.patch(`/api/groups/${groupId}/expenses/${expenseId}`, {
          description: "ホテル",
          amount: 9000,
          payerId: C,
          splits: [
            { memberId: A, shareAmount: 3000 },
            { memberId: B, shareAmount: 3000 },
            { memberId: C, shareAmount: 3000 },
          ],
        });
        expect(await statusOf(B)).toBe("paid");
        // The new payer is settled by definition.
        expect(await statusOf(C)).toBe("paid");
      });
    });

    it("does not leave orphaned splits behind", async () => {
      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "3人",
        amount: 9000,
        payerId: A,
        participantIds: [A, B, C],
      });
      const before = await state();
      const id = before.expenses[0].id;

      await user.patch(`/api/groups/${groupId}/expenses/${id}`, {
        description: "2人に変更",
        amount: 4000,
        payerId: A,
        splits: [
          { memberId: A, shareAmount: 2000 },
          { memberId: B, shareAmount: 2000 },
        ],
      });

      const after = await state();
      expect(after.expenses[0].splits).toHaveLength(2);
      expect(netOf(after, C)).toBe(0);
    });
  });

  describe("deleting", () => {
    it("removes an expense and its effect on balances", async () => {
      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "消す予定",
        amount: 6000,
        payerId: A,
        participantIds: [A, B],
      });
      const before = await state();
      await user.delete(`/api/groups/${groupId}/expenses/${before.expenses[0].id}`);

      const after = await state();
      expect(after.expenses).toHaveLength(0);
      expect(netOf(after, A)).toBe(0);
    });

    it("cascades: deleting the payer erases the expenses they covered", async () => {
      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "あゆみが立替",
        amount: 6000,
        payerId: A,
        participantIds: [A, B],
      });
      await user.delete(`/api/groups/${groupId}/members/${A}`);

      const after = await state();
      // This is destructive by design; the UI warns about it before deleting.
      expect(after.expenses).toHaveLength(0);
      expect(after.members.map((m: any) => m.id)).not.toContain(A);
    });

    it("cascades: deleting a participant drops them from other people's splits", async () => {
      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "けんたが立替",
        amount: 6000,
        payerId: B,
        participantIds: [B, C],
      });
      await user.delete(`/api/groups/${groupId}/members/${C}`);

      const after = await state();
      expect(after.expenses).toHaveLength(1);
      expect(after.expenses[0].splits.map((s: any) => s.memberId)).not.toContain(C);
      expect(netOf(after, B)).toBe(0);
    });
  });

  describe("revision counter", () => {
    it("advances on every mutation so pollers notice changes", async () => {
      const seen: number[] = [];
      seen.push((await state()).revision);

      await user.post(`/api/groups/${groupId}/members`, { name: "だいき" });
      seen.push((await state()).revision);

      await user.post(`/api/groups/${groupId}/expenses`, {
        description: "x",
        amount: 1000,
        payerId: A,
        participantIds: [A, B],
      });
      seen.push((await state()).revision);

      for (let i = 1; i < seen.length; i++) {
        expect(seen[i]).toBeGreaterThan(seen[i - 1]);
      }
    });
  });
});
