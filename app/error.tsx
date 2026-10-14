"use client";

// データベース（D1）の一時的な障害時に出す画面。
// lib/db.ts が D1 の失敗を DbUnavailableError として投げるので、HTTPステータスは 5xx になる
// （「データ準備中」を 200 で返したり、施設ページを 404 にしたりしない）。
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <meta name="robots" content="noindex" />
      <h1 className="mb-2">ただいま表示できません</h1>
      <div className="rounded border border-dashed border-line-strong bg-surface px-4 py-10 text-center">
        <p className="text-sm font-bold text-ink">データベースに一時的に接続できませんでした</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">
          時間をおいて、もう一度お試しください。
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded border border-line-strong px-4 py-1.5 text-xs text-accent hover:bg-tint"
        >
          再読み込み
        </button>
      </div>
    </main>
  );
}
