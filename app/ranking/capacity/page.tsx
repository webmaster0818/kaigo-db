import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { abs, NO_DATA, seg } from "@/lib/site";
import { rankingRobots } from "@/lib/indexing";
import {
  CAPACITY_COVERAGE_NOTE,
  filterLabel,
  parseRankingParams,
  RANKING_AXES,
  withQuery,
} from "@/lib/ranking";
import Breadcrumb from "@/components/Breadcrumb";
import RankingFilter from "@/components/RankingFilter";
import RankingNote from "@/components/RankingNote";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

const PATH = "/ranking/capacity/";
const LIMIT = 100;
const AXIS = RANKING_AXES.find((a) => a.href === PATH)!;

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * 並べ替えロジック（SQL）:
 *   SELECT ... FROM facility
 *   WHERE capacity IS NOT NULL AND capacity > 0 [AND pref_slug = ?] [AND service_type_slug = ?]
 *   ORDER BY capacity DESC, name ASC, id ASC
 *
 * 定員が NULL の行は WHERE で落とす。「記載が無い」と「定員が小さい」は別物なので、
 * 末尾に並べることもしない（この一覧には出てこない）。
 */

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const types = await queries.typeCounts();
  const p = parseRankingParams(sp, types);
  const label = filterLabel(p);
  const rows = p.unknownFilter
    ? 0
    : (await queries.capacityStats({ prefSlug: p.prefSlug, typeSlug: p.typeSlug })).with_capacity;
  const robots = rankingRobots({ rows, filters: p.filters, unknownFilter: p.unknownFilter });

  return {
    title: label ? `${label}の介護施設を定員が多い順に並べる` : "介護施設を定員が多い順に並べる",
    description:
      `${label ? `${label}の` : "全国の"}介護施設・事業所を、厚生労働省の公表データの「定員」が大きい順に並べた一覧です。` +
      "定員の記載がある施設のみを対象としています。当サイトによる評価・推薦ではありません。",
    // index するページは絞り込み込みで自己参照、noindex のページは絞り込み無しの本体を指す
    alternates: { canonical: abs(robots.index ? withQuery(PATH, p.query) : PATH) },
    robots,
  };
}

export default async function CapacityRanking({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [meta, types] = await Promise.all([queries.meta(), queries.typeCounts()]);
  const p = parseRankingParams(sp, types);
  const label = filterLabel(p);
  const filter = { prefSlug: p.prefSlug, typeSlug: p.typeSlug };

  const [rows, stats] = p.unknownFilter
    ? [[], { total: 0, with_capacity: 0 }]
    : await Promise.all([queries.facilitiesByCapacity(filter, LIMIT), queries.capacityStats(filter)]);

  const rate = stats.total > 0 ? ((stats.with_capacity / stats.total) * 100).toFixed(1) : null;

  return (
    <main>
      <Breadcrumb
        items={[
          { name: "ホーム", href: "/" },
          { name: "並べ替えて探す", href: "/ranking/" },
          { name: label ? `定員が多い順（${label}）` : "定員が多い順" },
        ]}
      />
      <h1 className="mb-3">{label ? `${label}の介護施設` : "全国の介護施設"}を定員が多い順に並べる</h1>

      <RankingNote basis={AXIS.basis} extra={CAPACITY_COVERAGE_NOTE} />

      <RankingFilter action={PATH} types={types} pref={p.prefSlug} type={p.typeSlug} />

      {p.unknownFilter ? (
        <p className="card px-4 py-6 text-sm text-muted">
          指定された条件が見つかりませんでした。上の絞り込みから選び直してください。
        </p>
      ) : stats.with_capacity === 0 ? (
        <EmptyState
          detail={
            stats.total === 0
              ? "厚生労働省の公表データを準備しています。公開までしばらくお待ちください。"
              : "この条件では、定員の記載がある施設がありませんでした。条件を広げてお試しください。"
          }
        />
      ) : (
        <>
          <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted">この条件の掲載事業所</dt>
              <dd className="tabular-nums text-lg font-bold">{stats.total.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">うち定員の記載あり（並べ替えの対象）</dt>
              <dd className="tabular-nums text-lg font-bold">
                {stats.with_capacity.toLocaleString()}
                {rate && <span className="ml-2 text-xs font-normal text-muted">{rate}%</span>}
              </dd>
            </div>
          </dl>

          {/* ---- PC: 表 ---- */}
          <div className="hidden md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left text-xs text-muted">
                  <th scope="col" className="w-12 py-2 pr-3 text-right font-medium">順位</th>
                  <th scope="col" className="py-2 pr-3 font-medium">事業所名</th>
                  <th scope="col" className="w-20 py-2 pr-3 text-right font-medium">定員</th>
                  <th scope="col" className="w-44 py-2 pr-3 font-medium">種別</th>
                  <th scope="col" className="w-40 py-2 pr-3 font-medium">市区町村</th>
                  <th scope="col" className="w-48 py-2 font-medium">法人</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f, i) => (
                  <tr key={f.id} className="border-b border-line align-top hover:bg-tint">
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/facility/${seg(f.id)}/`} className="font-medium underline-offset-2 hover:text-accent hover:underline">
                        {f.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-bold">{f.capacity}人</td>
                    <td className="py-2 pr-3 text-muted">
                      <Link href={`/type/${seg(f.service_type_slug)}/`} className="hover:text-accent hover:underline">
                        {f.service_type}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-muted">
                      {f.pref_slug && f.city_slug ? (
                        <Link href={`/area/${seg(f.pref_slug)}/${seg(f.city_slug)}/`} className="hover:text-accent hover:underline">
                          {f.prefecture}{f.city}
                        </Link>
                      ) : (
                        <span className="text-muted-2">{NO_DATA}</span>
                      )}
                    </td>
                    <td className="py-2 text-muted">
                      {f.corporation_slug && f.corporation_name ? (
                        <Link href={`/hojin/${seg(f.corporation_slug)}/`} className="hover:text-accent hover:underline">
                          {f.corporation_name}
                        </Link>
                      ) : (
                        <span className="text-muted-2">{NO_DATA}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ---- スマホ: カード ---- */}
          <ul className="space-y-2 md:hidden">
            {rows.map((f, i) => (
              <li key={f.id} className="card p-3">
                <div className="flex items-baseline gap-2">
                  <span className="tabular-nums text-xs text-muted">{i + 1}</span>
                  <Link href={`/facility/${seg(f.id)}/`} className="font-medium underline-offset-2 hover:underline">
                    {f.name}
                  </Link>
                </div>
                <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-muted">定員</dt>
                  <dd className="tabular-nums font-bold">{f.capacity}人</dd>
                  <dt className="text-muted">種別</dt>
                  <dd>{f.service_type}</dd>
                  <dt className="text-muted">市区町村</dt>
                  <dd>{[f.prefecture, f.city].filter(Boolean).join(" ") || NO_DATA}</dd>
                  <dt className="text-muted">法人</dt>
                  <dd>{f.corporation_name || <span className="text-muted-2">{NO_DATA}</span>}</dd>
                </dl>
              </li>
            ))}
          </ul>

          {stats.with_capacity > rows.length && (
            <p className="mt-3 text-xs text-muted">
              定員の記載がある{stats.with_capacity.toLocaleString()}件のうち、先頭{rows.length.toLocaleString()}件を表示しています。
              件数を絞るには上の条件をご利用ください。
            </p>
          )}
        </>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted">
        定員は出典データの値をそのまま表示しています（当サイトで推定した数値はありません）。
        定員は建物の規模を表す数字であって、サービスの内容や質を表すものではありません。
      </p>

      <p className="mt-3 text-xs">
        <Link href="/ranking/" className="text-accent hover:underline">ほかの並べ替えを見る →</Link>
      </p>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
