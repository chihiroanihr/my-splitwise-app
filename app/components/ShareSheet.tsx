"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { Participant } from "@/lib/types";
import ConfirmDialog from "./ConfirmDialog";

type CopyState = "idle" | "copied" | "failed";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Copy text without assuming the async Clipboard API is usable.
 * navigator.clipboard is absent on http origins and rejects when the document
 * isn't focused, so fall back to a hidden textarea + execCommand.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function ShareSheet({
  groupId,
  url,
  groupName,
  isOwner,
  onRotated,
  onClose,
}: {
  groupId: string;
  url: string;
  groupName: string;
  isOwner: boolean;
  onRotated: () => void;
  onClose: () => void;
}) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Participant | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, mutate } = useSWR<{ participants: Participant[] }>(
    `/api/groups/${groupId}/participants`,
    fetcher,
    // Poll like the rest of the app, so someone joining shows up while the
    // sheet is open. dedupingInterval must be 0: reopening the sheet shortly
    // after closing it would otherwise be served from cache, showing a stale
    // participant count at the exact moment the user opened it to check.
    { refreshInterval: 5000, revalidateOnMount: true, dedupingInterval: 0 }
  );
  const participants = data?.participants ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  async function handleCopy() {
    const ok = await copyText(url);
    setCopy(ok ? "copied" : "failed");
    if (!ok) inputRef.current?.select();
    setTimeout(() => setCopy("idle"), 2500);
  }

  async function handleNativeShare() {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: `精算: ${groupName}`, url });
    } catch {
      // Dismissed, or refused by the platform. The link is on screen anyway.
    }
  }

  async function rotate() {
    setConfirmRotate(false);
    setBusy(true);
    try {
      await fetch(`/api/groups/${groupId}/participants`, { method: "POST" });
      onRotated();
    } finally {
      setBusy(false);
    }
  }

  async function removeParticipant() {
    const p = pendingRemove;
    if (!p) return;
    setPendingRemove(null);
    setBusy(true);
    try {
      await fetch(`/api/groups/${groupId}/participants/${p.userId}`, {
        method: "DELETE",
      });
      mutate();
    } finally {
      setBusy(false);
    }
  }

  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        className="relative max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl pb-sheet sm:rounded-3xl sm:pb-5"
      >
        <h2 id="share-title" className="text-base font-bold text-slate-900">
          「{groupName}」に招待
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          このリンクを開いた人だけがグループに参加できます。
        </p>

        <div className="mt-4 flex gap-2">
          <input
            ref={inputRef}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 outline-none ring-brand-500 focus:ring-2"
          />
          <button
            onClick={handleCopy}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-95"
          >
            コピー
          </button>
        </div>

        <div className="mt-2 min-h-[1.25rem] text-xs">
          {copy === "copied" && (
            <span className="font-semibold text-emerald-600">✓ コピーしました</span>
          )}
          {copy === "failed" && (
            <span className="font-semibold text-amber-600">
              コピーできませんでした。上のリンクを選択して手動でコピーしてください
            </span>
          )}
        </div>

        {canNativeShare && (
          <button
            onClick={handleNativeShare}
            className="mt-2 w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition active:scale-95"
          >
            他のアプリで共有
          </button>
        )}

        {/* Who is currently inside */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            アクセスできる端末 ({participants.length})
          </h3>
          <ul className="space-y-1.5">
            {participants.map((p) => (
              <li
                key={p.userId}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm text-slate-700">
                    {p.role === "owner" ? "作成者" : "参加者"}
                    {p.isYou && (
                      <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[9px] font-bold text-brand-700">
                        この端末
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {new Date(p.joinedAt).toLocaleDateString("ja-JP")} 参加
                  </div>
                </div>
                {p.role !== "owner" && (isOwner || p.isYou) && (
                  <button
                    onClick={() => setPendingRemove(p)}
                    disabled={busy}
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition active:scale-95 hover:text-red-600 disabled:opacity-50"
                  >
                    {p.isYou ? "退出" : "解除"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            名前ではなく端末単位です。同じ人が複数の端末から参加すると別々に並びます。
          </p>
        </div>

        {isOwner && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              onClick={() => setConfirmRotate(true)}
              disabled={busy}
              className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 transition active:scale-95 disabled:opacity-50"
            >
              招待リンクを作り直す
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              リンクが流出したときに使ってください。今のリンクは使えなくなります。
              すでに参加している人はそのまま残ります。
            </p>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition active:scale-95 hover:bg-slate-50"
        >
          閉じる
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          リンクを知っている人は誰でも参加できます。転送に注意してください。
        </p>
      </div>

      <ConfirmDialog
        open={confirmRotate}
        title="招待リンクを作り直しますか？"
        description="新しいリンクが発行されます。"
        warnings={[
          "今までのリンクは開けなくなります",
          "まだ参加していない人には、新しいリンクを送り直す必要があります",
        ]}
        confirmLabel="作り直す"
        tone="default"
        onConfirm={rotate}
        onCancel={() => setConfirmRotate(false)}
      />

      <ConfirmDialog
        open={pendingRemove !== null}
        title={
          pendingRemove?.isYou
            ? "このグループから退出しますか？"
            : "この端末のアクセスを解除しますか？"
        }
        description={
          pendingRemove?.isYou
            ? "招待リンクをもう一度開けば再参加できます。"
            : undefined
        }
        warnings={
          pendingRemove?.isYou
            ? ["この端末からグループが見えなくなります"]
            : [
                "その端末からグループが見えなくなります",
                "招待リンクを持っていれば再び参加できます。完全に締め出すにはリンクも作り直してください",
              ]
        }
        confirmLabel={pendingRemove?.isYou ? "退出する" : "解除する"}
        onConfirm={removeParticipant}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
