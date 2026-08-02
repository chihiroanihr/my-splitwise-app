"use client";

import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function AdminPage() {
  const { data, mutate } = useSWR<{ isAdmin: boolean; configured: boolean }>(
    "/api/admin",
    fetcher
  );
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "failed" | "throttled">(
    "idle"
  );

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setStatus("working");
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: key.trim() }),
    });
    if (res.ok) {
      setKey("");
      setStatus("idle");
      mutate();
    } else {
      setStatus(res.status === 429 ? "throttled" : "failed");
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-600">
        ‹ 戻る
      </Link>

      <h1 className="mb-1 mt-4 text-2xl font-bold tracking-tight text-slate-900">
        管理者設定
      </h1>
      <p className="mb-6 text-sm leading-relaxed text-slate-500">
        管理キーを入力すると、この端末からすべてのグループを閲覧・編集できるようになります。
      </p>

      {data?.isAdmin ? (
        <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-3xl" aria-hidden>🔑</p>
          <p className="mt-2 font-semibold text-slate-800">
            この端末は管理者として登録済みです
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm active:scale-95"
          >
            グループ一覧へ
          </Link>
        </div>
      ) : (
        <form
          onSubmit={claim}
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
        >
          <label htmlFor="admin-key" className="mb-2 block text-sm font-semibold text-slate-700">
            管理キー
          </label>
          <input
            id="admin-key"
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); setStatus("idle"); }}
            autoComplete="off"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base outline-none ring-brand-500 focus:ring-2"
          />
          {status === "failed" && (
            <p className="mt-2 text-xs font-semibold text-red-600">
              管理キーが違います
            </p>
          )}
          {status === "throttled" && (
            <p className="mt-2 text-xs font-semibold text-amber-600">
              試行回数が多すぎます。しばらく待ってからお試しください
            </p>
          )}
          {data && !data.configured && (
            <p className="mt-2 text-xs leading-relaxed text-amber-600">
              サーバーに ADMIN_KEY が設定されていません。Vercel の環境変数に追加してください。
            </p>
          )}
          <button
            type="submit"
            disabled={status === "working" || !key.trim()}
            className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition active:scale-95 disabled:bg-slate-300"
          >
            管理者として登録
          </button>
        </form>
      )}
    </div>
  );
}
