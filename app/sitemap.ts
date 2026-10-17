import type { MetadataRoute } from "next";
import { queries } from "@/lib/db";
import { abs, seg } from "@/lib/site";
import { RANKING_AXES } from "@/lib/ranking";

// D1から都度生成する（ビルド時にデータが無くても壊れない）
export const dynamic = "force-dynamic";

// noindex のページは載せない。sitemapの上限(5万URL)に収まるよう施設は上限を掛ける。
// 法人ページは /hojin/sitemap.xml に分けた（2026-10-16）。両方を /sitemap_index.xml から辿れる。
// 読む D1 行: agg の4 key（siteStats・typeCounts・sitemapAreas・indexableFacilityIds）を各1行。
// いずれも cachedAgg で6時間キャッシュされるので、当たれば0行。
const FACILITY_LIMIT = 45000;

// 一覧・TOP系のテンプレートを最後に書き換えた日（10/16 文言改稿）。
// /ranking/・/area/tokyo/ などが、D1を読めず noindex を返していた 9/30〜10/10 のクロール結果のまま残っているため、
// 変更日を示して再クロールを促す（施設・法人の個別ページには付けない）。
const LIST_LASTMOD = "2026-10-16";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [types, areas, facilities, total] = await Promise.all([
    queries.typeCounts(),
    queries.sitemapAreaSlugs(),
    queries.indexableFacilityIds(FACILITY_LIMIT),
    queries.totalCount(),
  ]);

  const prefSlugs = [...new Set(areas.map(([p]) => p).filter(Boolean))];

  // 並べ替え一覧。絞り込み無しのURLだけを載せる
  // （?pref= / ?type= 付きは薄い組み合わせが noindex になるため sitemap には出さない）。
  // データ0件のときは全て noindex なので、まとめて載せない。
  const rankingEntries: MetadataRoute.Sitemap =
    total > 0
      ? [
          { url: abs("/ranking/"), lastModified: LIST_LASTMOD, priority: 0.6 },
          ...RANKING_AXES.filter((a) => a.inSitemap).map((a) => ({ url: abs(a.href), lastModified: LIST_LASTMOD, priority: 0.6 })),
        ]
      : [];

  const entries: MetadataRoute.Sitemap = [
    { url: abs("/"), lastModified: LIST_LASTMOD, priority: 1 },
    { url: abs("/area/"), lastModified: LIST_LASTMOD, priority: 0.8 },
    { url: abs("/type/"), lastModified: LIST_LASTMOD, priority: 0.8 },
    { url: abs("/hojin/"), lastModified: LIST_LASTMOD, priority: 0.6 },
    { url: abs("/data/"), lastModified: LIST_LASTMOD, priority: 0.5 },
    ...rankingEntries,
    ...prefSlugs.map((p) => ({ url: abs(`/area/${seg(p)}/`), lastModified: LIST_LASTMOD, priority: 0.7 })),
    ...areas.map(([p, c]) => ({ url: abs(`/area/${seg(p)}/${seg(c)}/`), priority: 0.7 })),
    ...types.map((t) => ({ url: abs(`/type/${seg(t.service_type_slug)}/`), lastModified: LIST_LASTMOD, priority: 0.7 })),
    ...facilities.map((f) => ({ url: abs(`/facility/${seg(f.id)}/`), priority: 0.5 })),
  ];

  return entries;
}
