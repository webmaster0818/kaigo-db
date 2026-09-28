import Link from "next/link";
import type { Facility } from "@/lib/db";
import { formatDistance } from "@/lib/geo";
import { NO_DATA, seg } from "@/lib/site";

export type FacilityRow = Facility & { distance_km?: number };

interface Props {
  rows: FacilityRow[];
  /** 距離列を出すか（現在地検索の結果のみ true） */
  showDistance?: boolean;
  /** 種別列を隠す（種別ページ） */
  hideType?: boolean;
  /** 市区町村列を隠す（市区町村ページ） */
  hideCity?: boolean;
  /** 法人列を隠す（法人ページ） */
  hideCorp?: boolean;
}

function cityHref(f: Facility): string | null {
  if (!f.pref_slug || !f.city_slug) return null;
  return `/area/${seg(f.pref_slug)}/${seg(f.city_slug)}/`;
}

/**
 * 一覧表示。
 * - PC: 1行1施設の表（数字が縦に揃うことを優先。装飾は罫線のみ）
 * - スマホ: 横スクロールさせずカードに切り替える
 */
export default function FacilityTable({ rows, showDistance, hideType, hideCity, hideCorp }: Props) {
  if (rows.length === 0) {
    return (
      <p className="rounded border border-line bg-surface px-4 py-8 text-center text-sm text-muted">
        該当する施設はありません。
      </p>
    );
  }

  return (
    <>
      {/* ---- PC: 表 ---- */}
      <div className="hidden md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-ink text-left text-xs text-muted">
              {showDistance && <th scope="col" className="w-20 py-2 pr-3 font-medium">距離</th>}
              <th scope="col" className="py-2 pr-3 font-medium">事業所名</th>
              {!hideType && <th scope="col" className="w-48 py-2 pr-3 font-medium">種別</th>}
              {!hideCity && <th scope="col" className="w-40 py-2 pr-3 font-medium">市区町村</th>}
              <th scope="col" className="w-20 py-2 pr-3 text-right font-medium">定員</th>
              {!hideCorp && <th scope="col" className="w-56 py-2 font-medium">法人</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const ch = cityHref(f);
              return (
                <tr key={f.id} className="border-b border-line align-top hover:bg-tint">
                  {showDistance && (
                    <td className="py-2 pr-3 tabular-nums text-muted">
                      {f.distance_km == null ? NO_DATA : formatDistance(f.distance_km)}
                    </td>
                  )}
                  <td className="py-2 pr-3">
                    <Link href={`/facility/${seg(f.id)}/`} className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline">
                      {f.name}
                    </Link>
                  </td>
                  {!hideType && (
                    <td className="py-2 pr-3 text-muted">
                      <Link href={`/type/${seg(f.service_type_slug)}/`} className="hover:text-accent hover:underline">
                        {f.service_type}
                      </Link>
                    </td>
                  )}
                  {!hideCity && (
                    <td className="py-2 pr-3 text-muted">
                      {ch ? (
                        <Link href={ch} className="hover:text-accent hover:underline">
                          {f.city || NO_DATA}
                        </Link>
                      ) : (
                        f.city || NO_DATA
                      )}
                    </td>
                  )}
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {f.capacity == null ? <span className="text-muted-2">{NO_DATA}</span> : `${f.capacity}人`}
                  </td>
                  {!hideCorp && (
                    <td className="py-2 text-muted">
                      {f.corporation_slug && f.corporation_name ? (
                        <Link href={`/hojin/${seg(f.corporation_slug)}/`} className="hover:text-accent hover:underline">
                          {f.corporation_name}
                        </Link>
                      ) : (
                        <span className="text-muted-2">{NO_DATA}</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- スマホ: カード ---- */}
      <ul className="space-y-2 md:hidden">
        {rows.map((f) => (
          <li key={f.id} className="rounded border border-line bg-surface p-3">
            <Link href={`/facility/${seg(f.id)}/`} className="font-medium text-ink underline-offset-2 hover:underline">
              {f.name}
            </Link>
            <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">
              {showDistance && (
                <>
                  <dt className="text-muted">距離</dt>
                  <dd className="tabular-nums">{f.distance_km == null ? NO_DATA : formatDistance(f.distance_km)}</dd>
                </>
              )}
              <dt className="text-muted">種別</dt>
              <dd>{f.service_type}</dd>
              <dt className="text-muted">市区町村</dt>
              <dd>{[f.prefecture, f.city].filter(Boolean).join(" ") || NO_DATA}</dd>
              <dt className="text-muted">定員</dt>
              <dd className="tabular-nums">{f.capacity == null ? <span className="text-muted-2">{NO_DATA}</span> : `${f.capacity}人`}</dd>
              <dt className="text-muted">法人</dt>
              <dd>{f.corporation_name || <span className="text-muted-2">{NO_DATA}</span>}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
