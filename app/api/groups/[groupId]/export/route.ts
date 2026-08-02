import { getGroupState } from "@/lib/queries";
import { authorizeGroup, isDenied } from "@/lib/session";

export const dynamic = "force-dynamic";

/** RFC 4180 quoting: wrap in quotes and double any quote inside. */
function cell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per person per expense, so the file can be pivoted in a spreadsheet.
 * A row per expense would have to cram the participants into one cell.
 */
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
  if (!state) return new Response("not found", { status: 404 });

  const nameOf = new Map(state.members.map((m) => [m.id, m.name]));
  const date = (ms: number) =>
    new Date(ms).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  const rows: string[] = [
    ["日付", "項目", "合計金額", "立替者", "対象者", "負担額", "状態"].join(","),
  ];

  // Oldest first reads better in a spreadsheet than the newest-first UI order.
  for (const e of [...state.expenses].reverse()) {
    for (const s of e.splits) {
      rows.push(
        [
          cell(date(e.createdAt)),
          cell(e.description),
          cell(e.amount),
          cell(nameOf.get(e.payerId) ?? "?"),
          cell(nameOf.get(s.memberId) ?? "?"),
          cell(s.shareAmount),
          cell(s.memberId === e.payerId ? "立替本人" : s.status === "paid" ? "精算済み" : "未精算"),
        ].join(",")
      );
    }
  }

  const filename = `${state.group.name.replace(/[^\p{L}\p{N}_-]+/gu, "_")}_${date(Date.now()).replace(/\//g, "")}.csv`;

  // Excel assumes Shift_JIS for CSV unless the file starts with a UTF-8 BOM,
  // which turns every Japanese name into mojibake.
  return new Response("\uFEFF" + rows.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
