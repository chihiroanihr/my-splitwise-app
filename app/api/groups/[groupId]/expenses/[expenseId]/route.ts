import { NextResponse } from "next/server";
import { deleteExpense, updateExpense } from "@/lib/queries";
import { authorizeGroup, isDenied } from "@/lib/session";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ groupId: string; expenseId: string }> }
) {
  const { groupId, expenseId } = await params;
  const auth = await authorizeGroup(groupId);
  if (isDenied(auth)) return auth;

  const body = await req.json().catch(() => null);

  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const amount = Number(body?.amount);
  const payerId = typeof body?.payerId === "string" ? body.payerId : "";
  const splits: { memberId: string; shareAmount: number }[] = [];

  if (Array.isArray(body?.splits)) {
    for (const s of body.splits) {
      if (typeof s?.memberId === "string" && Number.isFinite(Number(s?.shareAmount))) {
        splits.push({ memberId: s.memberId, shareAmount: Number(s.shareAmount) });
      }
    }
  }

  if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
  if (!payerId) return NextResponse.json({ error: "payerId is required" }, { status: 400 });
  if (splits.length === 0) return NextResponse.json({ error: "at least one participant is required" }, { status: 400 });

  const total = splits.reduce((s, x) => s + x.shareAmount, 0);
  if (Math.abs(total - amount) > 1) {
    return NextResponse.json({ error: `splits sum (${total}) does not match amount (${amount})` }, { status: 400 });
  }

  const expectedRevision = Number.isInteger(body?.revision)
    ? Number(body.revision)
    : undefined;

  const result = await updateExpense({
    groupId,
    expenseId,
    description,
    amount,
    payerId,
    splits,
    expectedRevision,
  });

  if (!result.ok) {
    if (result.reason === "missing") {
      return NextResponse.json(
        { error: "この支払いは削除されました" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        error: "他の人がこの支払いを更新しました。最新の内容を確認してください",
        currentRevision: result.currentRevision,
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ groupId: string; expenseId: string }> }
) {
  const { groupId, expenseId } = await params;
  const auth = await authorizeGroup(groupId);
  if (isDenied(auth)) return auth;

  await deleteExpense(groupId, expenseId);
  return NextResponse.json({ ok: true });
}
