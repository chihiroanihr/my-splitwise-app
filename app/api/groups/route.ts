import { NextResponse } from "next/server";
import { listGroups, createGroup } from "@/lib/queries";

// Always hit the database; never prerender this at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ groups: await listGroups() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const group = await createGroup(name);
  return NextResponse.json({ group }, { status: 201 });
}
