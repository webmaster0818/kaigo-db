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
    // 掲載は入居系4種別のみ（47都道府県すべてに4種別とも掲載あり＝2026-10-19 /type/* の都道府県別内訳で確認）
    title: `${prefName}の介護施設一覧｜特養・老健・有料老人ホーム・グループホーム`,
    description: `${prefName}の介護施設${total > 0 ? ` ${total.toLocaleString()}件` : ""}（特別養護老人ホーム・介護老人保健施設・有料老人ホーム・グループホーム）を市区町村別に掲載しています。厚生労働省 介護サービス情報公表システムの公表データにもとづき、施設名・住所・定員・公式URLを確認できます。`,
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
      <h1 className="mb-3">{prefName}の介護施設・事業所</h1>
      <p className="mb-8 text-sm text-muted">
        {total > 0
          ? <>掲載 <span className="tabular-nums">{total.toLocaleString()}</span> 件／{cities.length} 市区町村</>
          : "この都道府県のデータは現在掲載しておりません。"}
      </p>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {cities.map((c) => (
            <li key={c.city_slug} className="reveal">
              <Link href={`/area/${seg(pref)}/${seg(c.city_slug)}/`} className="chip h-full w-full">
                {c.city}
                <span className="chip-count">{c.facility_count.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
