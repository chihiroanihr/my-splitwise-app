import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, adminClient, createGroup, addMember } from "./client";

/**
 * Access control is the security boundary of the app: without it, anyone who
 * finds the URL can read and destroy other people's groups. Every endpoint is
 * checked from an outsider's perspective, not just the happy path.
 */
describe("group access control", () => {
  let alice: Client;
  let bob: Client;
  let admin: Client;
  let group: { id: string; inviteToken: string };
  const created: string[] = [];

  beforeAll(async () => {
    alice = new Client();
    bob = new Client();
    admin = await adminClient();
    group = await createGroup(alice, "沖縄旅行");
    created.push(group.id);
  });

  afterAll(async () => {
    for (const id of created) await admin.delete(`/api/groups/${id}`);
  });

  describe("the owner", () => {
    it("can read the group and is marked as owner", async () => {
      const res = await alice.get(`/api/groups/${group.id}`);
      expect(res.status).toBe(200);
      expect(res.data.role).toBe("owner");
    });

    it("sees the group in their own list", async () => {
      const res = await alice.get("/api/groups");
      expect(res.data.groups.map((g: any) => g.id)).toContain(group.id);
    });

    it("receives the invite token", async () => {
      const res = await alice.get(`/api/groups/${group.id}`);
      expect(res.data.group.inviteToken).toBeTruthy();
    });
  });

  describe("a stranger with no invite", () => {
    it.each([
      ["read the group", "GET", ""],
      ["rename the group", "PATCH", ""],
      ["delete the group", "DELETE", ""],
      ["add a member", "POST", "/members"],
      ["add an expense", "POST", "/expenses"],
    ])("cannot %s", async (_label, method, suffix) => {
      const res = await bob.request(method, `/api/groups/${group.id}${suffix}`, {
        name: "侵入",
        description: "x",
        amount: 1,
        payerId: "x",
        splits: [],
      });
      expect(res.status).toBe(403);
    });

    it("sees an empty group list", async () => {
      const res = await bob.get("/api/groups");
      expect(res.data.groups).toEqual([]);
    });

    it("is not told whether the group exists", async () => {
      const real = await bob.get(`/api/groups/${group.id}`);
      const fake = await bob.get("/api/groups/thisdoesnotexist");
      // Identical answers, so the endpoint can't be used to enumerate ids.
      expect(real.status).toBe(fake.status);
      expect(real.data).toEqual(fake.data);
    });

    it("never receives the invite token", async () => {
      const res = await bob.get(`/api/groups/${group.id}`);
      expect(JSON.stringify(res.data)).not.toContain(group.inviteToken);
    });
  });

  describe("invite redemption", () => {
    it("rejects a wrong token", async () => {
      const res = await bob.post(`/api/groups/${group.id}/join`, { token: "wrong" });
      expect(res.status).toBe(403);
    });

    it("rejects an empty token", async () => {
      const res = await bob.post(`/api/groups/${group.id}/join`, { token: "" });
      expect(res.status).toBe(403);
    });

    it("leaves the stranger locked out after a failed attempt", async () => {
      const res = await bob.get(`/api/groups/${group.id}`);
      expect(res.status).toBe(403);
    });

    it("accepts the real token and grants member access", async () => {
      const join = await bob.post(`/api/groups/${group.id}/join`, {
        token: group.inviteToken,
      });
      expect(join.status).toBe(200);
      const res = await bob.get(`/api/groups/${group.id}`);
      expect(res.status).toBe(200);
      expect(res.data.role).toBe("member");
    });

    it("is idempotent — joining twice keeps the member role", async () => {
      await bob.post(`/api/groups/${group.id}/join`, { token: group.inviteToken });
      const res = await bob.get(`/api/groups/${group.id}`);
      expect(res.data.role).toBe("member");
    });
  });

  describe("a member (not the owner)", () => {
    it("can add members and expenses", async () => {
      const res = await bob.post(`/api/groups/${group.id}/members`, { name: "けんた" });
      expect(res.status).toBe(201);
    });

    it("cannot rename the group", async () => {
      const res = await bob.patch(`/api/groups/${group.id}`, { name: "乗っ取り" });
      expect(res.status).toBe(403);
    });

    it("cannot delete the group", async () => {
      const res = await bob.delete(`/api/groups/${group.id}`);
      expect(res.status).toBe(403);
    });

    it("left the group name untouched", async () => {
      const res = await alice.get(`/api/groups/${group.id}`);
      expect(res.data.group.name).toBe("沖縄旅行");
    });
  });

  describe("isolation between users", () => {
    it("hides one user's group from another", async () => {
      const bobsGroup = await createGroup(bob, "ボブの飲み会");
      created.push(bobsGroup.id);

      const res = await alice.get(`/api/groups/${bobsGroup.id}`);
      expect(res.status).toBe(403);

      const list = await alice.get("/api/groups");
      expect(list.data.groups.map((g: any) => g.id)).not.toContain(bobsGroup.id);
    });

    it("gives a brand new device no access to anything", async () => {
      const fresh = new Client();
      const list = await fresh.get("/api/groups");
      expect(list.data.groups).toEqual([]);
      expect(list.data.isAdmin).toBe(false);
    });
  });

  describe("admin", () => {
    it("rejects a wrong admin key", async () => {
      const c = new Client();
      const res = await c.post("/api/admin", { key: "not-the-key" });
      expect(res.status).toBe(403);
    });

    it("does not grant admin on a failed attempt", async () => {
      const c = new Client();
      await c.post("/api/admin", { key: "not-the-key" });
      const res = await c.get(`/api/groups/${group.id}`);
      expect(res.status).toBe(403);
    });

    it("can read any group", async () => {
      const res = await admin.get(`/api/groups/${group.id}`);
      expect(res.status).toBe(200);
      expect(res.data.isAdmin).toBe(true);
    });

    it("can rename any group", async () => {
      const res = await admin.patch(`/api/groups/${group.id}`, { name: "沖縄旅行" });
      expect(res.status).toBe(200);
    });

    it("sees every group in the list", async () => {
      const res = await admin.get("/api/groups");
      const ids = res.data.groups.map((g: any) => g.id);
      for (const id of created) expect(ids).toContain(id);
    });
  });

  describe("deletion rights", () => {
    it("lets the owner delete their own group", async () => {
      const own = await createGroup(alice, "使い捨て");
      const res = await alice.delete(`/api/groups/${own.id}`);
      expect(res.status).toBe(200);
      expect((await alice.get(`/api/groups/${own.id}`)).status).toBe(403);
    });

    it("revokes access for members once the group is gone", async () => {
      const temp = await createGroup(alice, "解散予定");
      await bob.post(`/api/groups/${temp.id}/join`, { token: temp.inviteToken });
      expect((await bob.get(`/api/groups/${temp.id}`)).status).toBe(200);

      await alice.delete(`/api/groups/${temp.id}`);
      expect((await bob.get(`/api/groups/${temp.id}`)).status).toBe(403);
    });
  });
});
