import Link from "next/link";
import type { TypeCount } from "@/lib/db";
import { PREF_ORDER, PREF_SLUGS } from "@/lib/slug";

/**
 * 並べ替え一覧の絞り込みフォーム。
 * GETで同じパスに投げ直すだけなので JS 不要（サーバコンポーネントのまま）。
 *
 * 種別の選択肢はデータから作る。データ0件のときは「すべて」だけになる。
 * 都道府県は固定表（lib/slug.ts）から出すのでデータ0件でも選択肢は並ぶ。
 */
export default function RankingFilter({
  action,
  types,
  pref,
  type,
  showType = true,
}: {
  /** 送信先のパス（例 /ranking/capacity/） */
  action: string;
  types: TypeCount[];
  pref?: string;
  type?: string;
  /** 種別で絞れない軸（市区町村あたりの件数など）では false */
  showType?: boolean;
}) {
  const hasFilter = Boolean(pref || (showType && type));

  return (
    <form method="get" action={action} className="mb-5 rounded border border-line bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-xs">
          <span className="text-muted">都道府県</span>
          <select
            name="pref"
            defaultValue={pref ?? ""}
            className="mt-1 w-full rounded border border-line-strong bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">すべて</option>
            {PREF_ORDER.map((name) => (
              <option key={PREF_SLUGS[name]} value={PREF_SLUGS[name]}>
                {name}
              </option>
            ))}
          </select>
        </label>

        {showType && (
          <label className="block text-xs">
            <span className="text-muted">サービス種別</span>
            <select
              name="type"
              defaultValue={type ?? ""}
              className="mt-1 w-full rounded border border-line-strong bg-surface px-2 py-1.5 text-sm"
            >
              <option value="">すべて</option>
              {types.map((t) => (
                <option key={t.service_type_slug} value={t.service_type_slug}>
                  {t.service_type}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded bg-accent px-4 py-1.5 text-sm font-bold text-white hover:bg-accent-strong"
          >
            絞り込む
          </button>
          {hasFilter && (
            <Link
              href={action}
              className="rounded border border-line-strong px-3 py-1.5 text-xs hover:bg-tint"
            >
              条件を解除
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}
