"use client";

import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

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
  url,
  groupName,
  onClose,
}: {
  url: string;
  groupName: string;
  onClose: () => void;
}) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

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
      // User dismissed the share sheet, or the platform refused. Nothing to do:
      // the link is on screen and the copy button still works.
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
        className="relative w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-xl pb-sheet sm:rounded-3xl sm:pb-5"
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

        <div className="mt-3 flex gap-2">
          {canNativeShare && (
            <button
              onClick={handleNativeShare}
              className="flex-1 rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition active:scale-95"
            >
              他のアプリで共有
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition active:scale-95 hover:bg-slate-50"
          >
            閉じる
          </button>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          リンクを知っている人は誰でも参加できます。転送に注意してください。
        </p>
      </div>
    </div>
  );
}
