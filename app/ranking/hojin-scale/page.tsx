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

const PATH = "/ranking/hojin-scale/";
const LIMIT = 100;
const AXIS = RANKING_AXES.find((a) => a.href === PATH)!;

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * 並べ替えロジック（SQL）:
 *
 *  絞り込み無し（corporation テーブルの集計値をそのまま使う）:
 *    SELECT slug, name, facility_count, pref_count FROM corporation
 *    WHERE facility_count > 0
 *    ORDER BY facility_count DESC, pref_count DESC, name ASC
 *
 *  都道府県・種別で絞るとき（「その条件の中での施設数」に意味が変わるため集計し直す）:
 *    SELECT corporation_slug AS slug, corporation_name AS name,
 *           COUNT(*) AS facility_count, COUNT(DISTINCT pref_slug) AS pref_count
 *    FROM facility WHERE corporation_slug <> '' [AND pref_slug = ?] [AND service_type_slug = ?]
 *    GROUP BY corporation_slug, corporation_name
 *    ORDER BY facility_count DESC, pref_count DESC, name ASC
 */

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const types = await queries.typeCounts();
  const p = parseRankingParams(sp, types);
  const label = filterLabel(p);
  const rows = p.unknownFilter
    ? 0
    : await queries.corporationScaleCount({ prefSlug: p.prefSlug, typeSlug: p.typeSlug });
  const robots = rankingRobots({ rows, filters: p.filters, unknownFilter: p.unknownFilter });

  return {
    title: label ? `${label}の運営法人を施設数が多い順に並べる` : "運営法人を施設数が多い順に並べる",
    description:
      `${label ? `${label}で` : "全国で"}同一法人が運営している介護事業所の件数が多い順に並べた一覧です。` +
      "件数は当サイトの掲載範囲での集計値で、当サイトによる評価・推薦ではありません。",
    alternates: { canonical: abs(robots.index ? withQuery(PATH, p.query) : PATH) },
    robots,
  };
}

export default async function HojinScaleRanking({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [meta, types] = await Promise.all([queries.meta(), queries.typeCounts()]);
  const p = parseRankingParams(sp, types);
  const label = filterLabel(p);
  const filter = { prefSlug: p.prefSlug, typeSlug: p.typeSlug };

  const [rows, total] = p.unknownFilter
    ? [[], 0]
    : await Promise.all([queries.corporationsByScale(filter, LIMIT), queries.corporationScaleCount(filter)]);

  const scoped = p.filters > 0;

  return (
    <main>
      <Breadcrumb
        items={[
          { name: "ホーム", href: "/" },
          { name: "並べ替えて探す", href: "/ranking/" },
          { name: label ? `法人の運営施設数が多い順（${label}）` : "法人の運営施設数が多い順" },
        ]}
      />
      <h1 className="mb-3">{label ? `${label}の運営法人` : "運営法人"}を施設数が多い順に並べる</h1>

      <RankingNote
        basis={AXIS.basis}
        extra={
          scoped
            ? `絞り込み中のため、件数は「${label}に限った施設数」です。法人全体の施設数は各法人のページでご確認ください。`
            : AXIS.note
        }
      />

      <RankingFilter action={PATH} types={types} pref={p.prefSlug} type={p.typeSlug} />

      {p.unknownFilter ? (
        <p className="rounded border border-line bg-surface px-4 py-6 text-sm text-muted">
          指定された条件が見つかりませんでした。上の絞り込みから選び直してください。
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          detail={
            total === 0 && p.filters === 0
              ? "厚生労働省の公表データを準備しています。公開までしばらくお待ちください。"
              : "この条件に該当する法人がありませんでした。条件を広げてお試しください。"
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left text-xs text-muted">
                  <th scope="col" className="w-12 py-2 pr-3 text-right font-medium">順位</th>
                  <th scope="col" className="py-2 pr-3 font-medium">法人名</th>
                  <th scope="col" className="w-28 py-2 pr-3 text-right font-medium">
                    {scoped ? "この条件の施設数" : "運営施設数"}
                  </th>
                  <th scope="col" className="w-28 py-2 text-right font-medium">展開都道府県数</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.slug} className="border-b border-line hover:bg-tint">
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/hojin/${seg(c.slug)}/`} className="font-medium underline-offset-2 hover:text-accent hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-bold">
                      {Number(c.facility_count).toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted">
                      {Number(c.pref_count).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > rows.length && (
            <p className="mt-3 text-xs text-muted">
              該当する{total.toLocaleString()}法人のうち、先頭{rows.length.toLocaleString()}法人を表示しています。
            </p>
          )}
        </>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted">
        法人名は出典データの表記をそのまま使っています。表記が異なる場合（法人格の有無・旧名称など）は別法人として数えるため、
        実際の運営規模と一致しないことがあります。施設数は規模を表す数字であって、サービスの内容や質を表すものではありません。
      </p>

      <p className="mt-3 text-xs">
        <Link href="/ranking/" className="text-accent hover:underline">ほかの並べ替えを見る →</Link>
      </p>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
