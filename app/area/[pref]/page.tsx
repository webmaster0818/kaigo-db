import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queries } from "@/lib/db";
import { SLUG_TO_PREF } from "@/lib/slug";
import { abs, decodeParam, seg } from "@/lib/site";
import { listRobots } from "@/lib/indexing";
import Breadcrumb from "@/components/Breadcrumb";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

type Params = Promise<{ pref: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { pref: prefRaw } = await params;
  const pref = decodeParam(prefRaw);
  const cities = await queries.citiesByPref(pref);
  const prefName = cities[0]?.prefecture ?? SLUG_TO_PREF[pref] ?? pref;
  const total = cities.reduce((s, c) => s + c.facility_count, 0);
  return {
    title: `${prefName}の介護施設・事業所一覧`,
    description: `${prefName}の介護施設・事業所${total > 0 ? ` ${total.toLocaleString()}件` : ""}を市区町村別に掲載。厚生労働省の公表データに基づく事業所名・住所・定員・公式URLを確認できます。`,
    alternates: { canonical: abs(`/area/${seg(pref)}/`) },
    robots: listRobots(total),
  };
}

export default async function PrefPage({ params }: { params: Params }) {
  const { pref: prefRaw } = await params;
  const pref = decodeParam(prefRaw);
  const prefName = SLUG_TO_PREF[pref];
  // 47都道府県以外のスラッグは存在しない
  if (!prefName) notFound();

  const [meta, cities] = await Promise.all([queries.meta(), queries.citiesByPref(pref)]);
  const total = cities.reduce((s, c) => s + c.facility_count, 0);

  return (
    <main>
      <Breadcrumb
        items={[
          { name: "ホーム", href: "/" },
          { name: "都道府県から探す", href: "/area/" },
          { name: prefName },
        ]}
      />
      <h1 className="mb-2">{prefName}の介護施設・事業所</h1>
      <p className="mb-5 text-sm text-muted">
        {total > 0
          ? <>掲載 <span className="tabular-nums">{total.toLocaleString()}</span> 件／{cities.length} 市区町村</>
          : "この都道府県のデータはまだ投入されていません。"}
      </p>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {cities.map((c) => (
            <li key={c.city_slug} className="flex items-baseline justify-between border-b border-line py-1">
              <Link href={`/area/${seg(pref)}/${seg(c.city_slug)}/`} className="hover:text-accent hover:underline">
                {c.city}
              </Link>
              <span className="tabular-nums text-xs text-muted">{c.facility_count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
