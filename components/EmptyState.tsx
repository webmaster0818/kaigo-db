/**
 * データ未投入（CSV未着）時の表示。
 * 架空データは作らない方針のため、0件のときは「準備中」と正直に出す。
 */
export default function EmptyState({
  title = "データ準備中",
  detail = "厚生労働省の公表データを準備しています。公開までしばらくお待ちください。",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div className="rounded border border-dashed border-line-strong bg-surface px-4 py-10 text-center">
      <p className="text-sm font-bold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">{detail}</p>
    </div>
  );
}
