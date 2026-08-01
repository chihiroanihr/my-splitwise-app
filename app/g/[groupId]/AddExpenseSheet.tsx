"use client";

import { useEffect, useState } from "react";
import type { Member } from "@/lib/types";
import { yen } from "@/lib/format";

type Mode = "equal" | "custom";

type InitialExpense = {
  id: string;
  description: string;
  amount: number;
  payerId: string;
  splits: { memberId: string; shareAmount: number }[];
};

function detectMode(splits: InitialExpense["splits"]): Mode {
  if (splits.length === 0) return "equal";
  const amounts = splits.map((s) => s.shareAmount);
  return Math.max(...amounts) - Math.min(...amounts) <= 1 ? "equal" : "custom";
}

export default function AddExpenseSheet({
  groupId,
  members,
  initialExpense,
  onClose,
  onSaved,
}: {
  groupId: string;
  members: Member[];
  initialExpense?: InitialExpense;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initialExpense;

  const [description, setDescription] = useState(initialExpense?.description ?? "");
  const [amount, setAmount] = useState(
    initialExpense ? String(initialExpense.amount) : ""
  );
  const [payerId, setPayerId] = useState<string>(
    initialExpense?.payerId ?? members[0]?.id ?? ""
  );
  const [participantIds, setParticipantIds] = useState<Set<string>>(
    initialExpense
      ? new Set(initialExpense.splits.map((s) => s.memberId))
      : new Set(members.map((m) => m.id))
  );
  const [mode, setMode] = useState<Mode>(
    initialExpense ? detectMode(initialExpense.splits) : "equal"
  );
  const [customAmounts, setCustomAmounts] = useState<Map<string, string>>(
    initialExpense
      ? new Map(initialExpense.splits.map((s) => [s.memberId, String(s.shareAmount)]))
      : new Map()
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalNum = Number(amount.replace(/[,，]/g, ""));
  const totalValid = Number.isFinite(totalNum) && totalNum > 0;

  // Sync customAmounts with participants & total when entering custom mode or
  // when participants/total change in custom mode (auto-fill missing entries).
  useEffect(() => {
    if (mode !== "custom") return;
    setCustomAmounts((prev) => {
      const next = new Map(prev);
      const ids = Array.from(participantIds);
      const equalShare =
        totalValid && ids.length > 0 ? Math.round(totalNum / ids.length) : 0;
      // Add missing
      for (const id of ids) {
        if (!next.has(id)) next.set(id, String(equalShare));
      }
      // Remove ones no longer in participants
      for (const key of Array.from(next.keys())) {
        if (!participantIds.has(key)) next.delete(key);
      }
      return next;
    });
  }, [mode, participantIds, totalNum, totalValid]);

  function toggleParticipant(id: string) {
    const next = new Set(participantIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setParticipantIds(next);
  }
  function selectAll() {
    setParticipantIds(new Set(members.map((m) => m.id)));
  }
  function clearAll() {
    setParticipantIds(new Set());
  }

  function distributeEqually() {
    if (!totalValid || participantIds.size === 0) return;
    const ids = Array.from(participantIds);
    const base = Math.floor(totalNum / ids.length);
    const remainder = totalNum - base * ids.length;
    const next = new Map<string, string>();
    ids.forEach((id, i) => {
      // Distribute remainder yen across the first few participants.
      const v = i < remainder ? base + 1 : base;
      next.set(id, String(v));
    });
    setCustomAmounts(next);
  }

  function setCustomAmount(id: string, value: string) {
    const next = new Map(customAmounts);
    next.set(id, value.replace(/[,，]/g, ""));
    setCustomAmounts(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!description.trim()) {
      setError("項目名を入力してください");
      return;
    }
    if (!totalValid) {
      setError("金額を正しく入力してください");
      return;
    }
    if (!payerId) {
      setError("支払った人を選択してください");
      return;
    }
    if (participantIds.size === 0) {
      setError("対象を1人以上選択してください");
      return;
    }

    let splits: { memberId: string; shareAmount: number }[] = [];
    if (mode === "equal") {
      const ids = Array.from(participantIds);
      const share = totalNum / ids.length;
      splits = ids.map((id) => ({ memberId: id, shareAmount: share }));
    } else {
      for (const id of participantIds) {
        const raw = customAmounts.get(id) ?? "";
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0) {
          setError("金額は0以上の数字で入力してください");
          return;
        }
        splits.push({ memberId: id, shareAmount: v });
      }
      const sum = splits.reduce((s, x) => s + x.shareAmount, 0);
      if (Math.abs(sum - totalNum) > 0.5) {
        setError(
          `合計が一致しません (${yen(sum)} / ${yen(totalNum)}、差 ${yen(sum - totalNum)})`
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const url = isEdit
        ? `/api/groups/${groupId}/expenses/${initialExpense!.id}`
        : `/api/groups/${groupId}/expenses`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          amount: totalNum,
          payerId,
          splits,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "エラーが発生しました");
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  if (members.length === 0) {
    return (
      <Backdrop onClose={onClose}>
        <p className="text-sm text-slate-600">
          先にメンバーを追加してください
        </p>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white"
        >
          閉じる
        </button>
      </Backdrop>
    );
  }

  const equalShare =
    totalValid && participantIds.size > 0
      ? Math.round(totalNum / participantIds.size)
      : null;

  const customSum =
    mode === "custom"
      ? Array.from(participantIds).reduce(
          (s, id) => s + (Number(customAmounts.get(id) ?? "0") || 0),
          0
        )
      : 0;
  const customDiff = totalValid ? customSum - totalNum : 0;
  const customMatches = Math.abs(customDiff) < 0.5;

  return (
    <Backdrop onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">{isEdit ? "支払いを編集" : "支払いを追加"}</h2>
        <button
          onClick={onClose}
          className="-m-2 p-2 text-2xl text-slate-400"
          aria-label="閉じる"
        >
          ×
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            項目名
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例: 居酒屋、ホテル代"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base outline-none ring-brand-500 focus:ring-2"
            maxLength={50}
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            金額（円）
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9,]*"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-lg font-semibold tabular-nums outline-none ring-brand-500 focus:ring-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            支払った人
          </label>
          <select
            value={payerId}
            onChange={(e) => setPayerId(e.target.value)}
            className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base outline-none ring-brand-500 focus:ring-2"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-xs font-semibold text-slate-600">
              割り勘の対象 ({participantIds.size}人)
            </label>
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={selectAll} className="text-brand-600 underline">
                全員
              </button>
              <button type="button" onClick={clearAll} className="text-slate-400 underline">
                解除
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = participantIds.has(m.id);
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => toggleParticipant(m.id)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition active:scale-95 ${
                    on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mode toggle */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-600">
            割り勘の方法
          </label>
          <div className="flex gap-1 rounded-full bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode("equal")}
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                mode === "equal" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              均等
            </button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                mode === "custom" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              個別指定
            </button>
          </div>

          {mode === "equal" && equalShare !== null && (
            <p className="mt-2 text-xs text-slate-500">
              1人あたり {yen(equalShare)}
            </p>
          )}

          {mode === "custom" && (
            <div className="mt-3 space-y-2">
              {participantIds.size === 0 ? (
                <p className="text-xs text-slate-400">対象を1人以上選択してください</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">各自の金額</span>
                    <button
                      type="button"
                      onClick={distributeEqually}
                      disabled={!totalValid}
                      className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                    >
                      均等にする
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {members
                      .filter((m) => participantIds.has(m.id))
                      .map((m) => {
                        const isPayer = m.id === payerId;
                        return (
                          <li key={m.id} className="flex items-center gap-2">
                            <span className="flex-1 truncate text-sm text-slate-700">
                              {m.name}
                              {isPayer && (
                                <span className="ml-1.5 text-[10px] font-bold text-brand-600">
                                  立替本人
                                </span>
                              )}
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9,]*"
                              value={customAmounts.get(m.id) ?? ""}
                              onChange={(e) => setCustomAmount(m.id, e.target.value)}
                              placeholder="0"
                              className="w-28 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums outline-none ring-brand-500 focus:ring-2"
                            />
                            <span className="text-xs text-slate-400">円</span>
                          </li>
                        );
                      })}
                  </ul>
                  {totalValid && (
                    <div
                      className={`mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold ${
                        customMatches
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      <span>合計</span>
                      <span className="tabular-nums">
                        {yen(customSum)} / {yen(totalNum)}
                        {!customMatches && (
                          <span className="ml-1.5">
                            ({customDiff > 0 ? "+" : ""}
                            {yen(customDiff)})
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-sm transition active:scale-95 disabled:bg-slate-300"
        >
          {submitting ? "保存中…" : isEdit ? "更新する" : "保存する"}
        </button>
      </form>
    </Backdrop>
  );
}

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-50 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white px-5 pt-5 shadow-xl ring-1 ring-slate-200 sm:rounded-3xl pb-sheet">
        {children}
      </div>
    </div>
  );
}
