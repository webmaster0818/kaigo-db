import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // 検索結果(クエリ付きトップ)はクロールさせない。
        // 以前は先頭に Allow: / を置いていたが、上から順に最初に当たった行を採る実装
        // （meta-externalagent など）には「全部許可」と読まれ、/?lat= が1日数千回叩かれていた（2026-10-20 tail で確認）。
        // 何も書かなければ許可なので、Allow 行は置かない。
        disallow: ["/?lat=", "/?"],
      },
    ],
    // インデックスと子 sitemap をすべて載せる（子は /sitemap_index.xml と同じ）
    sitemap: [abs("/sitemap_index.xml"), abs("/sitemap.xml"), abs("/hojin/sitemap.xml")],
  };
}
