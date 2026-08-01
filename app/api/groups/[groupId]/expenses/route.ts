import { NextResponse } from "next/server";
import { addExpense } from "@/lib/queries";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const body = await req.json().catch(() => null);

  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const amount = Number(body?.amount);
  const payerId = typeof body?.payerId === "string" ? body.payerId : "";

  // Accept either `splits: [{ memberId, shareAmount }]` (custom)
  // or `participantIds: [...]` (equal split, kept for backward compat).
  let splits: { memberId: string; shareAmount: number }[] = [];

  if (Array.isArray(body?.splits)) {
    for (const s of body.splits) {
      if (typeof s?.memberId === "string" && Number.isFinite(Number(s?.shareAmount))) {
        splits.push({ memberId: s.memberId, shareAmount: Number(s.shareAmount) });
      }
    }
  } else if (Array.isArray(body?.participantIds)) {
    const ids = body.participantIds.filter((x: unknown) => typeof x === "string");
    if (ids.length > 0 && Number.isFinite(amount)) {
      const share = amount / ids.length;
      splits = ids.map((id: string) => ({ memberId: id, shareAmount: share }));
    }
  }

  if (!description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
  }
  if (!payerId) {
    return NextResponse.json({ error: "payerId is required" }, { status: 400 });
  }
  if (splits.length === 0) {
    return NextResponse.json({ error: "at least one participant is required" }, { status: 400 });
  }

  // Validate sum of shares matches expense amount (with 1-yen tolerance for rounding).
  const total = splits.reduce((s, x) => s + x.shareAmount, 0);
  if (Math.abs(total - amount) > 1) {
    return NextResponse.json(
      { error: `splits sum (${total}) does not match amount (${amount})` },
      { status: 400 }
    );
  }

  const expense = await addExpense({ groupId, description, amount, payerId, splits });
  return NextResponse.json({ expense }, { status: 201 });
}
