"use client";

import Link from "next/link";
import useSWR from "swr";
import { useRef, useState } from "react";
import type { Group } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function HomePage() {
  const { data, mutate, isLoading } = useSWR<{ groups: Group[] }>(
    "/api/groups",
    fetcher,
    { refreshInterval: 5000 }
  );
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) { setName(""); mutate(); }
    } finally {
      setSubmitting(false);
    }
  }

  function startRename(g: Group) {
    setRenamingId(g.id);
    setRenameValue(g.name);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  async function commitRename(groupId: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) { cancelRename(); return; }
    setRenamingId(null);
    await fetch(`/api/groups/${groupId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    mutate();
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }

  async function deleteGroup(groupId: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？\nグループ内のすべての支払いデータも削除されます。`)) return;
    await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
    mutate();
  }

  const groups = data?.groups ?? [];

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">精算アプリ</h1>
        <p className="mt-1 text-sm text-slate-500">グループを作って、友達と割り勘しよう</p>
      </header>

      <section className="mb-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">新しいグループ</h2>
        <form onSubmit={createGroup} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 沖縄旅行"
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base outline-none ring-brand-500 focus:ring-2"
            maxLength={50}
          />
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            作成
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold text-slate-700">グループ一覧</h2>
        {isLoading ? (
          <p className="px-1 text-sm text-slate-400">読み込み中…</p>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            まだグループがありません。上で作成してね
          </div>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => {
              const isRenaming = renamingId === g.id;
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
                >
                  {/* Name + date area — clickable when not renaming */}
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(g.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitRename(g.id); }
                          if (e.key === "Escape") cancelRename();
                        }}
                        className="w-full rounded-lg border border-brand-400 px-2 py-1 text-base font-semibold text-slate-900 outline-none ring-2 ring-brand-200"
                        maxLength={50}
                      />
                    ) : (
                      <Link href={`/g/${g.id}`} className="block transition active:scale-[0.99]">
                        <div className="truncate text-base font-semibold text-slate-900">{g.name}</div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          作成日: {new Date(g.createdAt).toLocaleDateString("ja-JP")}
                        </div>
                      </Link>
                    )}
                  </div>

                  {/* Action buttons */}
                  {isRenaming ? (
                    <button
                      onClick={() => commitRename(g.id)}
                      className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition active:scale-95"
                    >
                      保存
                    </button>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => startRename(g)}
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600 active:scale-95"
                        aria-label="名前を変更"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => deleteGroup(g.id, g.name)}
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-red-500 active:scale-95"
                        aria-label="削除"
                      >
                        🗑
                      </button>
                      <Link href={`/g/${g.id}`} className="pl-1 text-slate-300 text-lg leading-none">
                        ›
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-8 px-1 text-xs text-slate-400">
        グループのURLを共有すれば、誰でも見て編集できます
      </p>
    </div>
  );
}
