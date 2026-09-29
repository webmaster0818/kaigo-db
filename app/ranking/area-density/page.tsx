import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { abs, seg } from "@/lib/site";
import { rankingRobots } from "@/lib/indexing";
import { filterLabel, parseRankingParams, RANKING_AXES, withQuery } from "@/lib/ranking";
import Breadcrumb from "@/components/Breadcrumb";
import RankingFilter from "@/components/RankingFilter";
import RankingNote from "@/components/RankingNote";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

const PATH = "/ranking/area-density/";
const LIMIT = 100;
const AXIS = RANKING_AXES.find((a) => a.href === PATH)!;

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * 並べ替えロジック（SQL）:
 *
 *  種別の絞り込み無し（area テーブルの集計値をそのまま使う）:
 *    SELECT pref_slug, prefecture, city_slug, city, facility_count FROM area
 *    WHERE facility_count > 0 [AND pref_slug = ?]
 *    ORDER BY facility_count DESC, prefecture ASC, city ASC
 *
 *  種別で絞るとき（area は種別を持たないので facility から集計し直す）:
 *    SELECT pref_slug, prefecture, city_slug, city, COUNT(*) AS facility_count
 *    FROM facility WHERE city_slug <> '' [AND pref_slug = ?] AND service_type_slug = ?
 *    GROUP BY pref_slug, prefecture, city_slug, city
 *    ORDER BY facility_count DESC, prefecture ASC, city ASC
 */

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const types = await queries.typeCounts();
  const p = parseRankingParams(sp, types);
  const label = filterLabel(p);
  const rows = p.unknownFilter
    ? 0
    : await queries.areaDensityCount({ prefSlug: p.prefSlug, typeSlug: p.typeSlug });
  const robots = rankingRobots({ rows, filters: p.filters, unknownFilter: p.unknownFilter });

  return {
    title: label ? `${label}の市区町村を施設数が多い順に並べる` : "市区町村を施設数が多い順に並べる",
    description:
      `${label ? `${label}の` : "全国の"}市区町村を、その区域内に登録されている介護事業所の件数が多い順に並べた一覧です。` +
      "件数そのものの並びで、当サイトによる評価・推薦ではありません。",
    alternates: { canonical: abs(robots.index ? withQuery(PATH, p.query) : PATH) },
    robots,
  };
}

export default async function AreaDensityRanking({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [meta, types] = await Promise.all([queries.meta(), queries.typeCounts()]);
  const p = parseRankingParams(sp, types);
  const label = filterLabel(p);
  const filter = { prefSlug: p.prefSlug, typeSlug: p.typeSlug };

  const [rows, total] = p.unknownFilter
    ? [[], 0]
    : await Promise.all([queries.areasByDensity(filter, LIMIT), queries.areaDensityCount(filter)]);

  const sum = rows.reduce((s, a) => s + Number(a.facility_count || 0), 0);

  return (
    <main>
      <Breadcrumb
        items={[
          { name: "ホーム", href: "/" },
          { name: "並べ替えて探す", href: "/ranking/" },
          { name: label ? `市区町村あたりの施設数が多い順（${label}）` : "市区町村あたりの施設数が多い順" },
        ]}
      />
      <h1 className="mb-3">{label ? `${label}の市区町村` : "全国の市区町村"}を施設数が多い順に並べる</h1>

      <RankingNote
        basis={AXIS.basis}
        extra={
          p.typeName
            ? `${p.typeName}に限った件数で並べています。${AXIS.note}`
            : AXIS.note
        }
      />

      <RankingFilter action={PATH} types={types} pref={p.prefSlug} type={p.typeSlug} />

      {p.unknownFilter ? (
        <p className="card px-4 py-6 text-sm text-muted">
          指定された条件が見つかりませんでした。上の絞り込みから選び直してください。
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          detail={
            total === 0 && p.filters === 0
              ? "厚生労働省の公表データを準備しています。公開までしばらくお待ちください。"
              : "この条件に該当する市区町村がありませんでした。条件を広げてお試しください。"
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left text-xs text-muted">
                  <th scope="col" className="w-12 py-2 pr-3 text-right font-medium">順位</th>
                  <th scope="col" className="py-2 pr-3 font-medium">市区町村</th>
                  <th scope="col" className="w-32 py-2 pr-3 font-medium">都道府県</th>
                  <th scope="col" className="w-24 py-2 text-right font-medium">施設数</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => (
                  <tr key={`${a.pref_slug}-${a.city_slug}`} className="border-b border-line hover:bg-tint">
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/area/${seg(a.pref_slug)}/${seg(a.city_slug)}/`}
                        className="font-medium underline-offset-2 hover:text-accent hover:underline"
                      >
                        {a.city}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-muted">
                      <Link href={`/area/${seg(a.pref_slug)}/`} className="hover:text-accent hover:underline">
                        {a.prefecture}
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums font-bold">
                      {Number(a.facility_count).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted">
            {total > rows.length
              ? `該当する${total.toLocaleString()}市区町村のうち、先頭${rows.length.toLocaleString()}件を表示しています（表示分の合計 ${sum.toLocaleString()}件）。`
              : `該当する${total.toLocaleString()}市区町村を表示しています（合計 ${sum.toLocaleString()}件）。`}
          </p>
        </>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted">
        件数は当サイトに掲載している事業所の数です。市区町村の面積・人口で割った密度ではないため、
        人口規模の大きい自治体ほど上位に並びます。近くの施設を探す場合は、
        <Link href="/" className="text-accent hover:underline">現在地からの距離検索</Link>
        をご利用ください。
      </p>

      <p className="mt-3 text-xs">
        <Link href="/ranking/" className="text-accent hover:underline">ほかの並べ替えを見る →</Link>
      </p>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
