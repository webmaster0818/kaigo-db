import type { MetadataRoute } from "next";
import { queries } from "@/lib/db";
import { abs, seg } from "@/lib/site";

// /hojin/sitemap.xml: 法人ページ（事業所1件以上＝listRobots で index になる法人すべて・約1.4万件）。
// 5万URLを超えたら generateSitemaps で分割すること。
// 読む D1 行: agg 'corporationSlugs' の1行（cachedAgg で6時間キャッシュ・当たれば0行）。
export const dynamic = "force-dynamic";

const MAX_URLS = 50000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await queries.allCorporationSlugs();
  return slugs.slice(0, MAX_URLS).map((s) => ({ url: abs(`/hojin/${seg(s)}/`), priority: 0.4 }));
}
