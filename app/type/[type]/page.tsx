import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { abs, decodeParam, NO_DATA, seg } from "@/lib/site";
import { listRobots } from "@/lib/indexing";
import Breadcrumb from "@/components/Breadcrumb";
import FacilityTable from "@/components/FacilityTable";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 100;

type Params = Promise<{ type: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { type: typeRaw } = await params;
  const type = decodeParam(typeRaw);
  const t = await queries.typeBySlug(type);
  const name = t?.service_type ?? type;
  const n = t?.facility_count ?? 0;
  return {
    title: `${name}の一覧`,
    description: `全国の${name}${n > 0 ? `${n.toLocaleString()}件` : ""}を都道府県・市区町村別に検索できます。事業所名・定員・運営法人・公式URLは厚生労働省の公表データに基づきます。`,
    alternates: { canonical: abs(`/type/${seg(type)}/`) },
    robots: listRobots(n),
  };
}

export default async function TypePage({ params }: { params: Params }) {
  const { type: typeRaw } = await params;
  const type = decodeParam(typeRaw);
  const [meta, t, rows, prefs] = await Promise.all([
    queries.meta(),
    queries.typeBySlug(type),
    queries.facilitiesByType(type, LIST_LIMIT),
    queries.typePrefBreakdown(type),
  ]);

  const name = t?.service_type ?? type;
  const total = t?.facility_count ?? 0;

  return (
    <main>
      <Breadcrumb
        items={[
          { name: "ホーム", href: "/" },
          { name: "サービス種別から探す", href: "/type/" },
          { name },
        ]}
      />
      <h1 className="mb-3">{name}</h1>

      {total === 0 ? (
        <EmptyState detail={`${name}のデータはまだ投入されていません。公開までしばらくお待ちください。`} />
      ) : (
        <>
          <p className="mb-5 text-sm text-muted">
            全国の掲載事業所数 <span className="tabular-nums font-bold text-ink">{total.toLocaleString()}</span> 件。
            定員・公式URLは記載のあるものだけを表示しています（未記載は「{NO_DATA}」）。
          </p>

          {prefs.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-2">都道府県別の件数</h2>
              <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {prefs.map((p) => (
                  <li key={p.pref_slug} className="flex items-baseline justify-between border-b border-line py-1">
                    <Link href={`/area/${seg(p.pref_slug)}/`} className="hover:text-accent hover:underline">
                      {p.prefecture}
                    </Link>
                    <span className="tabular-nums text-xs text-muted">{Number(p.n).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2">事業所一覧</h2>
            <FacilityTable rows={rows} hideType />
            {total > LIST_LIMIT && (
              <p className="mt-3 text-xs text-muted">
                全{total.toLocaleString()}件のうち先頭{LIST_LIMIT}件を表示しています。
                地域で絞り込むには上の都道府県別リンクをご利用ください。
              </p>
            )}
          </section>
        </>
      )}

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
