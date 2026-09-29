import type { MetadataRoute } from "next";
import { queries } from "@/lib/db";
import { abs, seg } from "@/lib/site";
import { RANKING_AXES } from "@/lib/ranking";

// D1から都度生成する（ビルド時にデータが無くても壊れない）
export const dynamic = "force-dynamic";

// noindex のページは載せない。sitemapの上限(5万URL)に収まるよう施設は上限を掛ける。
const FACILITY_LIMIT = 45000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [types, areas, corps, facilities, total] = await Promise.all([
    queries.typeCounts(),
    queries.allAreas(),
    queries.allCorporationSlugs(2, 3000),
    queries.indexableFacilityIds(FACILITY_LIMIT),
    queries.totalCount(),
  ]);

  const prefSlugs = [...new Set(areas.map((a) => a.pref_slug).filter(Boolean))];

  // 並べ替え一覧。絞り込み無しのURLだけを載せる
  // （?pref= / ?type= 付きは薄い組み合わせが noindex になるため sitemap には出さない）。
  // データ0件のときは全て noindex なので、まとめて載せない。
  const rankingEntries: MetadataRoute.Sitemap =
    total > 0
      ? [
          { url: abs("/ranking/"), priority: 0.6 },
          ...RANKING_AXES.filter((a) => a.inSitemap).map((a) => ({ url: abs(a.href), priority: 0.6 })),
        ]
      : [];

  const entries: MetadataRoute.Sitemap = [
    { url: abs("/"), priority: 1 },
    { url: abs("/area/"), priority: 0.8 },
    { url: abs("/type/"), priority: 0.8 },
    { url: abs("/data/"), priority: 0.5 },
    ...rankingEntries,
    ...prefSlugs.map((p) => ({ url: abs(`/area/${seg(p)}/`), priority: 0.7 })),
    ...areas.map((a) => ({ url: abs(`/area/${seg(a.pref_slug)}/${seg(a.city_slug)}/`), priority: 0.7 })),
    ...types.map((t) => ({ url: abs(`/type/${seg(t.service_type_slug)}/`), priority: 0.7 })),
    ...corps.map((c) => ({ url: abs(`/hojin/${seg(c.slug)}/`), priority: 0.4 })),
    ...facilities.map((f) => ({ url: abs(`/facility/${seg(f.id)}/`), priority: 0.5 })),
  ];

  return entries;
}
