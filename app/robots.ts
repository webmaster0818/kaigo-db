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
    sitemap: abs("/sitemap.xml"),
  };
}
