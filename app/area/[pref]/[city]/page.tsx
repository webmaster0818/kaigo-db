import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queries } from "@/lib/db";
import { SLUG_TO_PREF } from "@/lib/slug";
import { abs, decodeParam, NO_DATA, seg } from "@/lib/site";
import { listRobots } from "@/lib/indexing";
import Breadcrumb from "@/components/Breadcrumb";
import FacilityTable from "@/components/FacilityTable";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 300;

type Params = Promise<{ pref: string; city: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { pref: prefRaw, city: cityRaw } = await params;
  const pref = decodeParam(prefRaw);
  const city = decodeParam(cityRaw);
  const area = await queries.area(pref, city);
  const prefName = area?.prefecture ?? SLUG_TO_PREF[pref] ?? pref;
  const cityName = area?.city ?? city;
  const n = area?.facility_count ?? 0;
  return {
    title: `${prefName}${cityName}の介護施設・事業所一覧`,
    description: `${prefName}${cityName}の介護施設・事業所${n > 0 ? `${n.toLocaleString()}件` : ""}の一覧。事業所名・サービス種別・定員・運営法人・公式URLを厚生労働省の公表データから掲載しています。`,
    alternates: { canonical: abs(`/area/${seg(pref)}/${seg(city)}/`) },
    robots: listRobots(n),
  };
}

export default async function CityPage({ params }: { params: Params }) {
  const { pref: prefRaw, city: cityRaw } = await params;
  const pref = decodeParam(prefRaw);
  const city = decodeParam(cityRaw);
  if (!SLUG_TO_PREF[pref]) notFound();

  const [meta, area, rows] = await Promise.all([
    queries.meta(),
    queries.area(pref, city),
    queries.facilitiesByCity(pref, city, LIST_LIMIT),
  ]);

  const prefName = area?.prefecture ?? SLUG_TO_PREF[pref];
  const cityName = area?.city ?? city;
  const withCapacity = rows.filter((r) => r.capacity != null).length;
  const withUrl = rows.filter((r) => r.official_url).length;

  // 種別内訳（この市区町村の中）
  const byType = new Map<string, { name: string; slug: string; n: number }>();
  for (const r of rows) {
    const cur = byType.get(r.service_type_slug);
    if (cur) cur.n += 1;
    else byType.set(r.service_type_slug, { name: r.service_type, slug: r.service_type_slug, n: 1 });
  }
  const typeList = [...byType.values()].sort((a, b) => b.n - a.n);

  return (
    <main>
      <Breadcrumb
        items={[
          { name: "ホーム", href: "/" },
          { name: "都道府県から探す", href: "/area/" },
          { name: prefName, href: `/area/${seg(pref)}/` },
          { name: cityName },
        ]}
      />
      <h1 className="mb-3">{prefName}{cityName}の介護施設・事業所</h1>

      {rows.length === 0 ? (
        <EmptyState detail={`${prefName}${cityName}のデータはまだ投入されていません。公開までしばらくお待ちください。`} />
      ) : (
        <>
          <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-2 border-y border-line py-3 text-sm">
            <div>
              <dt className="text-xs text-muted">掲載事業所</dt>
              <dd className="tabular-nums text-lg font-bold">{(area?.facility_count ?? rows.length).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">定員の記載あり</dt>
              <dd className="tabular-nums text-lg font-bold">{withCapacity.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">公式URLあり</dt>
              <dd className="tabular-nums text-lg font-bold">{withUrl.toLocaleString()}</dd>
            </div>
          </dl>

          {typeList.length > 1 && (
            <ul className="mb-5 flex flex-wrap gap-2 text-xs">
              {typeList.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/type/${seg(t.slug)}/`}
                    className="inline-flex items-baseline gap-1 rounded border border-line bg-surface px-2 py-1 hover:border-accent hover:text-accent"
                  >
                    {t.name}<span className="tabular-nums text-muted">{t.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <FacilityTable rows={rows} hideCity />

          {(area?.facility_count ?? 0) > LIST_LIMIT && (
            <p className="mt-3 text-xs text-muted">
              件数が多いため先頭{LIST_LIMIT.toLocaleString()}件を表示しています。
            </p>
          )}

          <p className="mt-4 text-xs text-muted">
            定員・公式URLが「{NO_DATA}」の事業所は、出典データに値が無いものです（当サイトで推定した数値は一切ありません）。
          </p>
        </>
      )}

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
