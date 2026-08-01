"use client";

import { useEffect } from "react";

export type ConfirmTone = "danger" | "default";

/**
 * In-app replacement for window.confirm().
 * Native dialogs are silently suppressed by many in-app browsers (LINE,
 * Instagram) and by cross-origin frames, where confirm() just returns false and
 * the button appears dead. This always renders, and can show real context.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  warnings,
  confirmLabel = "削除する",
  cancelLabel = "キャンセル",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** Concrete consequences, e.g. "支払い 2 件も削除されます". */
  warnings?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    // Stop the page behind the dialog from scrolling on mobile.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        onClick={onCancel}
        aria-hidden
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-xl pb-sheet sm:rounded-3xl sm:pb-5"
      >
        <h2 id="confirm-title" className="text-base font-bold text-slate-900">
          {title}
        </h2>

        {description && (
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
        )}

        {warnings && warnings.length > 0 && (
          <ul className="mt-3 space-y-1.5 rounded-xl bg-red-50 p-3 ring-1 ring-red-100">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-sm text-red-700">
                <span aria-hidden>⚠️</span>
                <span className="leading-relaxed">{w}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition active:scale-95 hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm transition active:scale-95 ${
              tone === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-brand-600 hover:bg-brand-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
