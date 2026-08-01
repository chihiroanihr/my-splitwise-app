import { NextResponse } from "next/server";
import { getGroupState, deleteGroup, renameGroup, computeBalances } from "@/lib/queries";
import { authorizeGroup, isDenied } from "@/lib/session";

// Always hit the database; never prerender this at build time.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorizeGroup(groupId);
  if (isDenied(auth)) return auth;

  const state = await getGroupState(groupId, {
    role: auth.role,
    isAdmin: auth.session.isAdmin,
  });
  if (!state) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { balances, transfers } = computeBalances(state);
  return NextResponse.json({ ...state, balances, transfers });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorizeGroup(groupId, { ownerOnly: true });
  if (isDenied(auth)) return auth;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  await renameGroup(groupId, name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorizeGroup(groupId, { ownerOnly: true });
  if (isDenied(auth)) return auth;

  await deleteGroup(groupId);
  return NextResponse.json({ ok: true });
}
