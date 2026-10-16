import { abs } from "@/lib/site";

// sitemap インデックス。D1 は読まない。
// 子 sitemap を増やしたらここにも足すこと（各5万URL以下）。
const CHILDREN = ["/sitemap.xml", "/hojin/sitemap.xml"];

export function GET(): Response {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    CHILDREN.map((p) => `<sitemap><loc>${abs(p)}</loc></sitemap>`).join("\n") +
    `\n</sitemapindex>\n`;
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
