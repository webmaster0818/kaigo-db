import type { MetadataRoute } from "next";
import { queries } from "@/lib/db";
import { abs } from "@/lib/site";
import { typeCityPath } from "@/lib/typeCity";

// /type/sitemap.xml: 種別×市区町村ページ（index 対象施設3件以上の組み合わせすべて・2026-09-29 取得分で2,965件）。
// 3件未満の組み合わせはページを作らない（404）ので載せない。5万URLを超えたら generateSitemaps で分割すること。
// 読む D1 行: agg 'typeCityCombos' の1行（cachedAgg で6時間キャッシュ・当たれば0行）。
// worker.ts が描画済み XML を Cache API に保存する（CACHED_XML）。
export const dynamic = "force-dynamic";

const MAX_URLS = 50000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const combos = await queries.typeCityCombos();
  return combos.slice(0, MAX_URLS).map(([t, p, c]) => ({ url: abs(typeCityPath(t, p, c)), priority: 0.6 }));
}
