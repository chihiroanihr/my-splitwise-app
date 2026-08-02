import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, adminClient, createGroup, addMember } from "./client";

describe("CSV export", () => {
  let user: Client;
  let admin: Client;
  let groupId: string;
  let inviteToken: string;
  let A: string, B: string;
  const created: string[] = [];

  beforeAll(async () => {
    user = new Client();
    admin = await adminClient();
    const g = await createGroup(user, "沖縄, 2026");
    groupId = g.id;
    inviteToken = g.inviteToken;
    created.push(g.id);
    A = await addMember(user, groupId, "あゆみ");
    B = await addMember(user, groupId, 'けん"た');
    await user.post(`/api/groups/${groupId}/expenses`, {
      description: "ホテル代",
      amount: 9000,
      payerId: A,
      participantIds: [A, B],
    });
  });

  afterAll(async () => {
    for (const id of created) await admin.delete(`/api/groups/${id}`);
  });

  it("refuses a device with no access", async () => {
    const stranger = new Client();
    const res = await stranger.get(`/api/groups/${groupId}/export`);
    expect(res.status).toBe(403);
  });

  it("allows a joined member", async () => {
    const member = new Client();
    await member.post(`/api/groups/${groupId}/join`, { token: inviteToken });
    const res = await member.get(`/api/groups/${groupId}/export`);
    expect(res.status).toBe(200);
  });

  describe("content", () => {
    let csv: string;

    beforeAll(async () => {
      // Client.request falls back to raw text when the body isn't JSON.
      const res = await user.get(`/api/groups/${groupId}/export`);
      expect(res.status).toBe(200);
      csv = String(res.data);
    });

    it("starts with a UTF-8 BOM so Excel reads Japanese correctly", async () => {
      // Must be checked on the bytes: Response.text() strips the BOM.
      const { bytes } = await user.getBytes(`/api/groups/${groupId}/export`);
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    });

    it("has a header row and one row per participant", () => {
      const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
      expect(lines[0]).toBe("日付,項目,合計金額,立替者,対象者,負担額,状態");
      expect(lines).toHaveLength(3); // header + two participants
    });

    it("records the payer and the amounts", () => {
      expect(csv).toContain("ホテル代");
      expect(csv).toContain("9000");
      expect(csv).toContain("4500");
      expect(csv).toContain("立替本人");
      expect(csv).toContain("未精算");
    });

    it("quotes a value containing a double quote", () => {
      // けん"た must survive as けん""た inside quotes, per RFC 4180.
      expect(csv).toContain('"けん""た"');
    });
  });
});
