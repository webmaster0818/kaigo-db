import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { PREF_ORDER, PREF_SLUGS } from "@/lib/slug";
import { abs, seg } from "@/lib/site";
import Breadcrumb from "@/components/Breadcrumb";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "都道府県から探す",
  description: "全国47都道府県の介護施設・事業所を、市区町村単位で検索できます。厚生労働省の公表データにもとづく掲載件数を表示しています。",
  alternates: { canonical: abs("/area/") },
};

export default async function AreaIndex() {
  const [meta, prefs] = await Promise.all([queries.meta(), queries.prefectures()]);
  const bySlug = new Map(prefs.map((p) => [p.pref_slug, p]));
  const total = prefs.reduce((s, p) => s + Number(p.facility_count || 0), 0);

  return (
    <main>
      <Breadcrumb items={[{ name: "ホーム", href: "/" }, { name: "都道府県から探す" }]} />
      <h1 className="mb-3">都道府県から探す</h1>
      <p className="mb-8 text-sm text-muted">
        {total > 0 ? <>掲載している {total.toLocaleString()} 件の施設を、都道府県・市区町村で絞り込むことができます。</> : "データを準備しております。"}
      </p>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {PREF_ORDER.map((name) => {
            const slug = PREF_SLUGS[name];
            const row = bySlug.get(slug);
            const n = Number(row?.facility_count ?? 0);
            return (
              <li key={slug} className="reveal">
                {n > 0 ? (
                  <Link href={`/area/${slug}/`} className="chip w-full">
                    {name}
                    <span className="chip-count">{n.toLocaleString()}</span>
                  </Link>
                ) : (
                  <span className="chip chip-disabled w-full">
                    {name}
                    <span className="chip-count">-</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 都道府県スラッグは lib/slug.ts の固定表で管理（例: 東京都 → tokyo） */}
      <p className="mt-8 text-xs text-muted">
        市区町村名から探す場合は、都道府県ページ（例:{" "}
        <Link href={`/area/${seg("tokyo")}/`} className="text-accent hover:underline">/area/tokyo/</Link>
        ）をご利用ください。
      </p>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
