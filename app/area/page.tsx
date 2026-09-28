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
  description: "全国47都道府県の介護施設・事業所を、市区町村単位で検索できます。厚生労働省の公表データに基づく掲載件数付き。",
  alternates: { canonical: abs("/area/") },
};

export default async function AreaIndex() {
  const [meta, prefs] = await Promise.all([queries.meta(), queries.prefectures()]);
  const bySlug = new Map(prefs.map((p) => [p.pref_slug, p]));
  const total = prefs.reduce((s, p) => s + Number(p.facility_count || 0), 0);

  return (
    <main>
      <Breadcrumb items={[{ name: "ホーム", href: "/" }, { name: "都道府県から探す" }]} />
      <h1 className="mb-2">都道府県から探す</h1>
      <p className="mb-5 text-sm text-muted">
        {total > 0 ? <>掲載 {total.toLocaleString()} 件を都道府県・市区町村で絞り込めます。</> : "データを準備しています。"}
      </p>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {PREF_ORDER.map((name) => {
            const slug = PREF_SLUGS[name];
            const row = bySlug.get(slug);
            const n = Number(row?.facility_count ?? 0);
            return (
              <li key={slug} className="flex items-baseline justify-between border-b border-line py-1">
                {n > 0 ? (
                  <Link href={`/area/${slug}/`} className="hover:text-accent hover:underline">{name}</Link>
                ) : (
                  <span className="text-muted-2">{name}</span>
                )}
                <span className="tabular-nums text-xs text-muted">{n > 0 ? n.toLocaleString() : "-"}</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* 都道府県スラッグは lib/slug.ts の固定表で管理（例: 東京都 → tokyo） */}
      <p className="mt-6 text-xs text-muted">
        市区町村名から直接探す場合は、都道府県ページ（例:{" "}
        <Link href={`/area/${seg("tokyo")}/`} className="text-accent hover:underline">/area/tokyo/</Link>
        ）を開いてください。
      </p>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
