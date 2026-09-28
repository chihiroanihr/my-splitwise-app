"use client";

import Link from "next/link";
import useSWR from "swr";
import { useEffect, useMemo, useState } from "react";
import type { GroupState, Balance, Transfer } from "@/lib/types";
import { yen } from "@/lib/format";
import AddExpenseSheet from "./AddExpenseSheet";
import ConfirmDialog from "../../components/ConfirmDialog";
import ShareSheet from "../../components/ShareSheet";

type GroupResponse = GroupState & {
  balances: Balance[];
  transfers: Transfer[];
};

type FetchError = Error & { status?: number };

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) {
    const err = new Error("request failed") as FetchError;
    err.status = r.status;
    throw err;
  }
  return r.json();
};

/** Which destructive action is awaiting confirmation. */
type Pending =
  | { kind: "member"; memberId: string; name: string }
  | { kind: "expense"; expenseId: string; description: string }
  | null;

export default function GroupClient({ groupId }: { groupId: string }) {
  // An invite link lands here as ?join=<token>. Redeem it before the first
  // fetch, otherwise the API would (correctly) answer 403.
  const [joinState, setJoinState] = useState<"checking" | "joining" | "ready">("checking");
  const [joinFailed, setJoinFailed] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("join");
    if (!token) {
      // The token lives in window.location, which only exists after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJoinState("ready");
      return;
    }
    setJoinState("joining");
    (async () => {
      const res = await fetch(`/api/groups/${groupId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) setJoinFailed(true);
      // Drop the token from the address bar so it isn't re-shared by accident.
      window.history.replaceState(null, "", `/g/${groupId}`);
      setJoinState("ready");
    })();
  }, [groupId]);

  const { data, mutate, isLoading, error } = useSWR<GroupResponse>(
    joinState === "ready" ? `/api/groups/${groupId}` : null,
    fetcher,
    { refreshInterval: 3000, revalidateOnFocus: true }
  );

  const [memberName, setMemberName] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [tab, setTab] = useState<"expenses" | "settlement">("expenses");
  const [showShare, setShowShare] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const memberById = useMemo(() => {
    const m = new Map<string, string>();
    data?.members.forEach((x) => m.set(x.id, x.name));
    return m;
  }, [data]);

  // What actually disappears if the pending member is deleted. Expenses cascade
  // on the payer, so removing someone can erase other people's debts too.
  const memberImpact = useMemo(() => {
    if (pending?.kind !== "member" || !data) return null;
    const id = pending.memberId;
    const paidExpenses = data.expenses.filter((e) => e.payerId === id);
    const paidTotal = paidExpenses.reduce((s, e) => s + e.amount, 0);
    const ownUnpaid = data.expenses
      .flatMap((e) => e.splits)
      .filter((s) => s.memberId === id && s.status === "unpaid")
      .reduce((s, x) => s + x.shareAmount, 0);
    const othersOwed = paidExpenses
      .flatMap((e) => e.splits.filter((s) => s.memberId !== id && s.status === "unpaid"))
      .reduce((s, x) => s + x.shareAmount, 0);
    return { count: paidExpenses.length, paidTotal, ownUnpaid, othersOwed };
  }, [pending, data]);

  if (joinState !== "ready" || (isLoading && !error)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center text-slate-400">
        読み込み中…
      </div>
    );
  }

  if (error) {
    // Anything that isn't a deliberate 403/404 is a server or network problem.
    // Reporting those as "not found" sends people hunting for a wrong URL when
    // the URL was fine all along.
    const status = (error as FetchError).status;
    const view =
      status === 403
        ? {
            icon: "🔒",
            title: "このグループへのアクセス権がありません",
            detail: joinFailed
              ? "招待リンクが正しくないか、作り直された可能性があります。作成者に新しいリンクをもらってください。"
              : "参加するには、グループの作成者から招待リンクを送ってもらってください。",
            retry: false,
          }
        : status === 404
        ? {
            icon: "🤔",
            title: "グループが見つかりません",
            detail: "URLをもう一度確認してください。削除された可能性もあります。",
            retry: false,
          }
        : {
            icon: "⚠️",
            title: "接続できませんでした",
            detail:
              "通信状況を確認して、もう一度お試しください。しばらく待つと復旧することがあります。",
            retry: true,
          };

    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <p className="text-4xl" aria-hidden>{view.icon}</p>
        <p className="mt-3 font-semibold text-slate-700">{view.title}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{view.detail}</p>
        {view.retry && (
          <button
            onClick={() => mutate()}
            className="mt-5 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-95"
          >
            再試行
          </button>
        )}
        <Link href="/" className="mt-5 block text-brand-600 underline">
          ホームに戻る
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const { group, members, expenses, balances, transfers, role, isAdmin } = data;
  // The token is only sent to owners and admins, so its presence is what
  // decides whether this device can bring anyone else in.
  const canInvite = Boolean(group.inviteToken);
  const inviteUrl =
    typeof window !== "undefined" && group.inviteToken
      ? `${window.location.origin}/g/${group.id}?join=${group.inviteToken}`
      : "";

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const name = memberName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setMemberName("");
      mutate();
    } finally {
      setAdding(false);
    }
  }

  async function runPending() {
    const p = pending;
    if (!p) return;
    setPending(null);
    if (p.kind === "member") {
      await fetch(`/api/groups/${groupId}/members/${p.memberId}`, { method: "DELETE" });
    } else {
      await fetch(`/api/groups/${groupId}/expenses/${p.expenseId}`, { method: "DELETE" });
    }
    mutate();
  }

  async function toggleSplit(splitId: string, current: "paid" | "unpaid") {
    const next = current === "paid" ? "unpaid" : "paid";
    // Optimistic update
    mutate(
      (curr) => {
        if (!curr) return curr;
        return {
          ...curr,
          expenses: curr.expenses.map((e) => ({
            ...e,
            splits: e.splits.map((s) =>
              s.id === splitId ? { ...s, status: next, paidAt: next === "paid" ? Date.now() : null } : s
            ),
          })),
        };
      },
      { revalidate: false }
    );
    await fetch(`/api/groups/${groupId}/splits/${splitId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    mutate();
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-32 pt-5">
      <header className="mb-5 flex items-center justify-between gap-2">
        <Link href="/" className="text-slate-400 hover:text-slate-600" aria-label="戻る">
          ‹ 戻る
        </Link>
        <button
          onClick={() => setShowShare(true)}
          className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-slate-200 active:scale-95"
        >
          {canInvite ? "招待リンク" : "参加者"}
        </button>
      </header>

      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>
        {isAdmin ? (
          <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-bold text-white">
            ADMIN
          </span>
        ) : role === "owner" ? (
          <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[9px] font-bold text-brand-600">
            作成者
          </span>
        ) : null}
      </div>
      <p className="mb-5 text-xs text-slate-400">
        メンバー {members.length}人 · 支払い {expenses.length}件
      </p>

      <section className="mb-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">メンバー</h2>
        {members.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-2">
            {members.map((m) => (
              <li
                key={m.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1.5 text-sm text-brand-700"
              >
                {m.name}
                <button
                  onClick={() => setPending({ kind: "member", memberId: m.id, name: m.name })}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-xs text-brand-600 hover:bg-brand-200"
                  aria-label={`${m.name}を削除`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addMember} className="flex gap-2">
          <input
            type="text"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
            placeholder="メンバー名を追加"
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
            maxLength={30}
          />
          <button
            type="submit"
            disabled={adding || !memberName.trim()}
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition active:scale-95 disabled:bg-slate-300"
          >
            追加
          </button>
        </form>
      </section>

      <div className="mb-3 flex gap-1 rounded-full bg-slate-100 p-1">
        <button
          onClick={() => setTab("expenses")}
          className={`flex-1 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
            tab === "expenses" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
          }`}
        >
          支払い
        </button>
        <button
          onClick={() => setTab("settlement")}
          className={`flex-1 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
            tab === "settlement" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
          }`}
        >
          精算
        </button>
      </div>

      {tab === "expenses" ? (
        <ExpensesTab
          expenses={expenses}
          memberById={memberById}
          onToggle={toggleSplit}
          onDelete={(id, description) =>
            setPending({ kind: "expense", expenseId: id, description })
          }
          onEdit={(id) => setEditingExpenseId(id)}
        />
      ) : (
        <SettlementTab
          groupId={groupId}
          balances={balances}
          transfers={transfers}
          memberById={memberById}
          hasExpenses={expenses.length > 0}
        />
      )}

      {/* Floating add button */}
      {tab === "expenses" && members.length >= 1 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-floating">
          <button
            onClick={() => setShowAddExpense(true)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold leading-none text-white shadow-lg shadow-brand-600/30 transition active:scale-95"
          >
            <span className="text-base leading-none">＋</span>
            <span className="leading-none">支払いを追加</span>
          </button>
        </div>
      )}

      {showAddExpense && (
        <AddExpenseSheet
          groupId={groupId}
          members={members}
          onClose={() => setShowAddExpense(false)}
          onSaved={() => { setShowAddExpense(false); mutate(); }}
        />
      )}

      {editingExpenseId && (() => {
        const exp = expenses.find((e) => e.id === editingExpenseId);
        if (!exp) return null;
        return (
          <AddExpenseSheet
            groupId={groupId}
            members={members}
            initialExpense={{
              id: exp.id,
              description: exp.description,
              amount: exp.amount,
              payerId: exp.payerId,
              revision: exp.revision,
              splits: exp.splits.map((s) => ({ memberId: s.memberId, shareAmount: s.shareAmount })),
            }}
            onClose={() => setEditingExpenseId(null)}
            onSaved={() => { setEditingExpenseId(null); mutate(); }}
            onConflict={() => mutate()}
          />
        );
      })()}

      {showShare && (
        <ShareSheet
          groupId={groupId}
          url={inviteUrl}
          groupName={group.name}
          isOwner={role === "owner" || isAdmin}
          // A rotated token means the URL on screen is stale — refetch it.
          onRotated={() => mutate()}
          onClose={() => setShowShare(false)}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === "member"
            ? `「${pending.name}」を削除しますか？`
            : `「${pending?.description ?? ""}」を削除しますか？`
        }
        description="この操作は取り消せません。"
        warnings={
          pending?.kind === "member"
            ? buildMemberWarnings(memberImpact)
            : ["この支払いの精算記録がすべて削除されます"]
        }
        confirmLabel="削除する"
        onConfirm={runPending}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function buildMemberWarnings(
  impact: { count: number; paidTotal: number; ownUnpaid: number; othersOwed: number } | null
): string[] {
  if (!impact) return ["このメンバーが関わる精算記録が削除されます"];
  const out: string[] = [];
  if (impact.count > 0) {
    out.push(
      `この人が立て替えた支払い ${impact.count} 件（合計 ${yen(impact.paidTotal)}）が丸ごと削除されます`
    );
  }
  if (impact.othersOwed > 0) {
    out.push(
      `他のメンバーがこの人に返すはずだった ${yen(impact.othersOwed)} の記録も消えます`
    );
  }
  if (impact.ownUnpaid > 0) {
    out.push(`この人の未精算 ${yen(impact.ownUnpaid)} の記録が消えます`);
  }
  if (out.length === 0) {
    out.push("このメンバーはどの支払いにも関わっていないため、影響はありません");
  }
  return out;
}

function ExpensesTab({
  expenses,
  memberById,
  onToggle,
  onDelete,
  onEdit,
}: {
  expenses: GroupState["expenses"];
  memberById: Map<string, string>;
  onToggle: (splitId: string, current: "paid" | "unpaid") => void;
  onDelete: (expenseId: string, description: string) => void;
  onEdit: (expenseId: string) => void;
}) {
  if (expenses.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        まだ支払いがありません。
        <br />
        下のボタンから追加してね
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {expenses.map((exp) => {
        const payerName = memberById.get(exp.payerId) ?? "?";
        const unpaidCount = exp.splits.filter(
          (s) => s.memberId !== exp.payerId && s.status === "unpaid"
        ).length;
        // Detect equal split: all share amounts within 1-yen of each other.
        const amounts = exp.splits.map((s) => s.shareAmount);
        const minA = Math.min(...amounts);
        const maxA = Math.max(...amounts);
        const isEqualSplit = exp.splits.length === 0 || maxA - minA <= 1;
        const equalShare = exp.splits.length > 0 ? amounts[0] : 0;
        return (
          <li
            key={exp.id}
            className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"
          >
            <div className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold text-slate-900">
                  {exp.description}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{payerName}</span> が立て替え
                  {isEqualSplit ? (
                    <> · 1人あたり {yen(equalShare)}</>
                  ) : (
                    <> · 個別指定</>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-base font-bold tabular-nums text-slate-900">
                  {yen(exp.amount)}
                </div>
                {unpaidCount > 0 ? (
                  <div className="mt-0.5 text-[10px] font-semibold text-amber-600">
                    未精算 {unpaidCount}人
                  </div>
                ) : (
                  <div className="mt-0.5 text-[10px] font-semibold text-emerald-600">
                    精算済み
                  </div>
                )}
              </div>
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                対象 ({exp.splits.length}人)
              </div>
              <ul className="space-y-3">
                {[...exp.splits]
                  .sort((a, b) =>
                    a.memberId === exp.payerId ? -1 : b.memberId === exp.payerId ? 1 : 0
                  )
                  .map((s) => {
                    const name = memberById.get(s.memberId) ?? "?";
                    const isPayer = s.memberId === exp.payerId;
                    if (isPayer) {
                      return (
                        <li
                          key={s.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-brand-50 px-2.5 py-2 ring-1 ring-brand-100"
                        >
                          <span className="text-sm font-semibold text-brand-700">
                            {name}
                          </span>
                          <div className="flex items-center gap-2">
                            {!isEqualSplit && (
                              <span className="text-xs font-medium tabular-nums text-brand-700/70">
                                {yen(s.shareAmount)}
                              </span>
                            )}
                            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                              立替本人
                            </span>
                          </div>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1"
                      >
                        <span className="text-sm text-slate-700">{name}</span>
                        <div className="flex items-center gap-2">
                          {s.status === "unpaid" && (
                            <span className="text-sm font-semibold tabular-nums text-slate-700">
                              {yen(s.shareAmount)}
                            </span>
                          )}
                          <button
                            onClick={() => onToggle(s.id, s.status)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm transition active:scale-95 ${
                              s.status === "paid"
                                ? "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
                                : "border-amber-500 bg-amber-400 text-white shadow-amber-200 hover:bg-amber-500"
                            }`}
                          >
                            {s.status === "paid" ? "✓ 精算" : "未精算"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
              </ul>
              <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
                <button
                  onClick={() => onEdit(exp.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition active:scale-95 hover:bg-slate-50 hover:text-brand-600"
                >
                  <span aria-hidden>✏️</span>
                  <span>編集</span>
                </button>
                <button
                  onClick={() => onDelete(exp.id, exp.description)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition active:scale-95 hover:bg-slate-50 hover:text-red-600"
                >
                  <span aria-hidden>🗑</span>
                  <span>削除</span>
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SettlementTab({
  groupId,
  balances,
  transfers,
  memberById,
  hasExpenses,
}: {
  groupId: string;
  balances: Balance[];
  transfers: Transfer[];
  memberById: Map<string, string>;
  hasExpenses: boolean;
}) {
  const allSettled = transfers.length === 0;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">残高</h3>
        {balances.length === 0 ? (
          <p className="text-sm text-slate-400">メンバーがまだいません</p>
        ) : (
          <>
            <ul className="space-y-2">
              {balances.map((b) => {
                const name = memberById.get(b.memberId) ?? "?";
                const positive = b.net > 0.005;
                const negative = b.net < -0.005;
                return (
                  <li
                    key={b.memberId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-slate-800">{name}</span>
                    <span
                      className={`tabular-nums font-semibold ${
                        positive
                          ? "text-emerald-600"
                          : negative
                          ? "text-red-500"
                          : "text-slate-400"
                      }`}
                    >
                      {positive ? "+" : ""}
                      {yen(b.net)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[11px] text-slate-400">
              プラスは受け取り、マイナスは支払いの残額です
            </p>
          </>
        )}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">最小の精算手順</h3>
        {balances.length === 0 ? (
          <p className="text-sm text-slate-400">メンバーがまだいません</p>
        ) : allSettled ? (
          <>
            <p className="text-sm text-emerald-600">🎉 全員精算済み！</p>
            <p className="mt-3 text-[11px] text-slate-400">
              支払いを「精算済」にすると、ここから自動で消えます
            </p>
          </>
        ) : (
          <>
            <ul className="space-y-2">
              {transfers.map((t, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm"
                >
                  <span>
                    <span className="font-semibold text-slate-900">
                      {memberById.get(t.fromMemberId) ?? "?"}
                    </span>
                    <span className="mx-1.5 text-slate-400">→</span>
                    <span className="font-semibold text-slate-900">
                      {memberById.get(t.toMemberId) ?? "?"}
                    </span>
                  </span>
                  <span className="tabular-nums font-bold text-slate-900">
                    {yen(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-slate-400">
              支払いを「精算済」にすると、ここから自動で消えます
            </p>
          </>
        )}
      </div>

      {hasExpenses && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">記録の保存</h3>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
            旅行が終わったあとも手元に残しておけます。表計算ソフトで開けます。
          </p>
          <a
            href={`/api/groups/${groupId}/export`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition active:scale-95 hover:bg-slate-50 hover:text-brand-600"
          >
            <span aria-hidden>⬇</span>
            <span>CSVでダウンロード</span>
          </a>
        </div>
      )}
    </div>
  );
}
