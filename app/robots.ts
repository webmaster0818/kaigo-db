import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // 検索結果(クエリ付きトップ)はクロールさせない
        disallow: ["/?lat=", "/?"],
      },
    ],
    // インデックスと子 sitemap をすべて載せる（子は /sitemap_index.xml と同じ）
    sitemap: [abs("/sitemap_index.xml"), abs("/sitemap.xml"), abs("/hojin/sitemap.xml")],
  };
}
