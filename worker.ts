// OpenNext が生成する Worker（.open-next/worker.js）の前段。
//
// クローラーがトップの距離検索（/?lat=…・/?q=…）を叩くと、1回ごとに D1 の近傍検索（平均約400行）と
// トップ全体の描画が走る。robots.txt で除外しているが守らない bot があり、2026-10-20 の tail では
// 全リクエストの約84%が meta-externalagent の /?lat=…（施設ページの「周辺3km以内を検索」から辿ったもの）で、
// CPU 上限超過(exceededCpu)の大半もここだった。D1 の近傍検索は 10/19 で約209万行（日次上限500万行の4割）。
// bot と分かる UA には、Next を通さずに短い 403 を返す。人のブラウザには何も変えない。

// @ts-expect-error: ビルド時に opennextjs-cloudflare build が生成する
import handler from "./.open-next/worker.js";

// @ts-expect-error: 同上
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const BOT_UA = /bot|crawl|spider|slurp|meta-externalagent|facebookexternalhit|bytespider|petalbot|ahrefs|semrush|dataforseo/i;

// 2026-10-21 15時(UTC)以降、Alibaba Cloud（AS45102・シンガポール）から、普通のブラウザを名乗る UA と
// 「referer: https://www.google.com/」付きで /?lat= が1日約1,500回叩かれ、D1 の近傍検索だけで約68万行
// （日次上限の約14%）を読んでいた（10/22 の tail で /?lat= 22件すべてがこの ASN）。UA では見分けられないので、
// 人が使うことのないクラウド事業者の ASN からの検索も、bot と同じ 403 にする。施設ページなどは今までどおり返す。
const CLOUD_ASN = new Set<number>([
  45102, 37963, // Alibaba Cloud
  132203, 45090, // Tencent Cloud
  136907, 55990, // Huawei Cloud
]);

function isSearchRequest(url: URL): boolean {
  if (url.pathname !== "/") return false;
  const p = url.searchParams;
  return p.has("lat") || p.has("lng") || p.has("q");
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    const asn = Number((request as unknown as { cf?: { asn?: number } }).cf?.asn ?? 0);
    if (isSearchRequest(url) && (BOT_UA.test(request.headers.get("user-agent") ?? "") || CLOUD_ASN.has(asn))) {
      return new Response("Search results are not available to crawlers (see /robots.txt).\n", {
        status: 403,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-robots-tag": "noindex",
          "cache-control": "public, max-age=86400",
        },
      });
    }
    return handler.fetch(request, env, ctx);
  },
};
