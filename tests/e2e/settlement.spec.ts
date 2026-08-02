import { test, expect, type Page } from "@playwright/test";

/**
 * These cover the failures that never show up in API tests: buttons that render
 * but do nothing. The delete buttons previously relied on window.confirm(),
 * which in-app browsers silently suppress, so they appeared dead.
 */

async function createGroup(page: Page, name: string) {
  await page.goto("/");
  await page.getByPlaceholder("例: 沖縄旅行").fill(name);
  await page.getByRole("button", { name: "作成" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function addMember(page: Page, name: string) {
  await page.getByPlaceholder("メンバー名を追加").fill(name);
  // `exact` matters: "支払いを追加" would otherwise match too.
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByRole("button", { name: `${name}を削除` })).toBeVisible();
}

async function addExpense(page: Page, description: string, amount: string) {
  await page.getByRole("button", { name: "支払いを追加" }).click();
  await page.getByPlaceholder("例: 居酒屋、ホテル代").fill(description);
  await page.getByPlaceholder("0").first().fill(amount);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText(description)).toBeVisible();
}

test.describe("group lifecycle", () => {
  test("creates a group, adds members and records a split", async ({ page }) => {
    await createGroup(page, `旅行${Date.now()}`);
    await addMember(page, "あゆみ");
    await addMember(page, "けんた");
    await addExpense(page, "ホテル代", "12000");

    await expect(page.getByText("¥12,000")).toBeVisible();
    // Equal split of 12000 between two people.
    await expect(page.getByText("1人あたり ¥6,000")).toBeVisible();
  });

  test("shows the settlement transfer on the 精算 tab", async ({ page }) => {
    await createGroup(page, `精算${Date.now()}`);
    await addMember(page, "あゆみ");
    await addMember(page, "けんた");
    await addExpense(page, "ホテル代", "12000");

    await page.getByRole("button", { name: "精算", exact: true }).click();
    await expect(page.getByText("最小の精算手順")).toBeVisible();
    await expect(page.getByText("¥6,000").first()).toBeVisible();
  });

  test("marking a split paid clears the settlement", async ({ page }) => {
    await createGroup(page, `完了${Date.now()}`);
    await addMember(page, "あゆみ");
    await addMember(page, "けんた");
    await addExpense(page, "ホテル代", "12000");

    await page.getByRole("button", { name: "未精算" }).click();
    await expect(page.getByRole("button", { name: "✓ 精算" })).toBeVisible();

    await page.getByRole("button", { name: "精算", exact: true }).click();
    await expect(page.getByText("全員精算済み")).toBeVisible();
  });
});

test.describe("destructive actions always confirm", () => {
  test("member delete opens a dialog instead of doing nothing", async ({ page }) => {
    await createGroup(page, `削除${Date.now()}`);
    await addMember(page, "あゆみ");

    await page.getByRole("button", { name: "あゆみを削除" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("「あゆみ」を削除しますか？");
  });

  test("cancelling leaves the member in place", async ({ page }) => {
    await createGroup(page, `取消${Date.now()}`);
    await addMember(page, "あゆみ");

    await page.getByRole("button", { name: "あゆみを削除" }).click();
    await page.getByRole("button", { name: "キャンセル" }).click();

    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByRole("button", { name: "あゆみを削除" })).toBeVisible();
  });

  test("confirming actually removes the member", async ({ page }) => {
    await createGroup(page, `確定${Date.now()}`);
    await addMember(page, "あゆみ");

    await page.getByRole("button", { name: "あゆみを削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();

    await expect(page.getByRole("button", { name: "あゆみを削除" })).toBeHidden();
  });

  test("warns with real figures before erasing a payer's expenses", async ({ page }) => {
    await createGroup(page, `警告${Date.now()}`);
    await addMember(page, "あゆみ");
    await addMember(page, "けんた");
    await addExpense(page, "ホテル代", "12000");

    await page.getByRole("button", { name: "あゆみを削除" }).click();

    const dialog = page.getByRole("alertdialog");
    // The payer's expense cascades away, taking けんた's debt with it.
    await expect(dialog).toContainText("¥12,000");
    await expect(dialog).toContainText("¥6,000");
  });

  test("expense delete opens a dialog", async ({ page }) => {
    await createGroup(page, `支払削除${Date.now()}`);
    await addMember(page, "あゆみ");
    await addExpense(page, "ホテル代", "5000");

    // `exact` keeps this off the member chip's "あゆみを削除" button.
    await page.getByRole("button", { name: "削除", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("「ホテル代」を削除しますか？");
  });

  test("group delete opens a dialog on the home screen", async ({ page }) => {
    const name = `グループ削除${Date.now()}`;
    await createGroup(page, name);
    await page.getByRole("link", { name: "戻る" }).click();

    await page.getByRole("button", { name: "削除", exact: true }).first().click();
    await expect(page.getByRole("alertdialog")).toContainText(`「${name}」を削除しますか？`);
  });
});

test.describe("invite sharing", () => {
  test("shows a copyable invite link", async ({ page }) => {
    await createGroup(page, `招待${Date.now()}`);
    await page.getByRole("button", { name: "招待リンク" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const url = await dialog.locator("input[readonly]").inputValue();
    expect(url).toContain("?join=");
    await expect(dialog.getByRole("button", { name: "コピー" })).toBeVisible();
  });

  test("gives feedback when the copy button is pressed", async ({ page }) => {
    await createGroup(page, `コピー${Date.now()}`);
    await page.getByRole("button", { name: "招待リンク" }).click();
    await page.getByRole("button", { name: "コピー" }).click();

    // Either outcome is acceptable — what must never happen is silence.
    await expect(
      page.getByText(/コピーしました|コピーできませんでした/)
    ).toBeVisible();
  });
});

test.describe("revoking access from the UI", () => {
  test("lists the devices that can open the group", async ({ page }) => {
    await createGroup(page, `参加者${Date.now()}`);
    await page.getByRole("button", { name: "招待リンク" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("アクセスできる端末 (1)");
    await expect(dialog).toContainText("この端末");
  });

  test("rotating the invite link kills the old one", async ({ page, browser }) => {
    await createGroup(page, `再発行${Date.now()}`);
    await page.getByRole("button", { name: "招待リンク" }).click();
    const oldUrl = await page.getByRole("dialog").locator("input[readonly]").inputValue();

    await page.getByRole("button", { name: "招待リンクを作り直す" }).click();
    // `exact` keeps this off the "招待リンクを作り直す" button behind the dialog.
    await page.getByRole("button", { name: "作り直す", exact: true }).click();

    // The sheet now shows a different link.
    await expect(async () => {
      const current = await page.getByRole("dialog").locator("input[readonly]").inputValue();
      expect(current).not.toBe(oldUrl);
    }).toPass();

    const stranger = await browser.newPage();
    await stranger.goto(oldUrl);
    await expect(stranger.getByText("このグループへのアクセス権がありません")).toBeVisible();
    await stranger.close();
  });

  test("the owner can revoke a joined device", async ({ page, browser }) => {
    await createGroup(page, `解除${Date.now()}`);
    await page.getByRole("button", { name: "招待リンク" }).click();
    const inviteUrl = await page.getByRole("dialog").locator("input[readonly]").inputValue();
    await page.getByRole("button", { name: "閉じる" }).click();

    const friend = await browser.newPage();
    await friend.goto(inviteUrl);
    // Members get the "参加者" button; only the owner sees "招待リンク".
    await expect(friend.getByRole("button", { name: "参加者" })).toBeVisible();

    await page.getByRole("button", { name: "招待リンク" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("アクセスできる端末 (2)");

    await dialog.getByRole("button", { name: "解除" }).click();
    await page.getByRole("button", { name: "解除する" }).click();
    await expect(dialog).toContainText("アクセスできる端末 (1)");

    await friend.reload();
    await expect(friend.getByText("このグループへのアクセス権がありません")).toBeVisible();
    await friend.close();
  });

  test("a member gets no invite link at all", async ({ page, browser }) => {
    await createGroup(page, `権限${Date.now()}`);
    await page.getByRole("button", { name: "招待リンク" }).click();
    const inviteUrl = await page.getByRole("dialog").locator("input[readonly]").inputValue();

    const friend = await browser.newPage();
    await friend.goto(inviteUrl);
    // The button is labelled for what they can actually do.
    await friend.getByRole("button", { name: "参加者" }).click();

    const dialog = friend.getByRole("dialog");
    await expect(dialog).toContainText("招待リンクを発行できるのは作成者だけです");
    await expect(dialog.locator("input[readonly]")).toHaveCount(0);
    await expect(
      friend.getByRole("button", { name: "招待リンクを作り直す" })
    ).toBeHidden();
    // But they can still leave on their own.
    await expect(friend.getByRole("button", { name: "退出" })).toBeVisible();
    await friend.close();
  });
});

test.describe("exporting", () => {
  test("offers a csv link that serves the group's records", async ({ page }) => {
    await createGroup(page, `記録${Date.now()}`);
    await addMember(page, "あゆみ");
    await addMember(page, "けんた");
    await addExpense(page, "ホテル代", "12000");

    await page.getByRole("button", { name: "精算", exact: true }).click();

    const link = page.getByRole("link", { name: "CSVでダウンロード" });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");

    // Fetching through the page's own session exercises the auth path too.
    // Waiting on a browser download event instead proved unreliable in CI
    // without testing anything extra: the file itself is what matters.
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");

    const body = await res.text();
    expect(body).toContain("ホテル代");
    expect(body).toContain("あゆみ");
    expect(body).toContain("6000");
  });

  test("offers no export before anything is recorded", async ({ page }) => {
    await createGroup(page, `空${Date.now()}`);
    await page.getByRole("button", { name: "精算", exact: true }).click();
    await expect(page.getByRole("link", { name: "CSVでダウンロード" })).toBeHidden();
  });
});

test.describe("access control in the browser", () => {
  test("a group is invisible to someone without an invite", async ({ page, browser }) => {
    await createGroup(page, `非公開${Date.now()}`);
    const url = page.url();

    // A fresh context is a different device: no cookie, no membership.
    const stranger = await browser.newPage();
    await stranger.goto(url);
    await expect(stranger.getByText("このグループへのアクセス権がありません")).toBeVisible();
    await stranger.close();
  });

  test("the home screen lists nothing for a new device", async ({ browser }) => {
    const stranger = await browser.newPage();
    await stranger.goto("/");
    await expect(stranger.getByText("まだグループがありません")).toBeVisible();
    await stranger.close();
  });

  test("an invite link grants access", async ({ page, browser }) => {
    await createGroup(page, `招待参加${Date.now()}`);
    await page.getByRole("button", { name: "招待リンク" }).click();
    const inviteUrl = await page.getByRole("dialog").locator("input[readonly]").inputValue();

    const friend = await browser.newPage();
    await friend.goto(inviteUrl);
    await expect(friend.getByRole("button", { name: "参加者" })).toBeVisible();
    // The token is stripped from the address bar after redemption.
    expect(friend.url()).not.toContain("join=");
    await friend.close();
  });
});
