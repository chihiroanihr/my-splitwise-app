import { NextResponse } from "next/server";
import { setSplitStatus } from "@/lib/queries";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ groupId: string; splitId: string }> }
) {
  const { groupId, splitId } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status;
  if (status !== "paid" && status !== "unpaid") {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  await setSplitStatus({ groupId, splitId, status });
  return NextResponse.json({ ok: true });
}
