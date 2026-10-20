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

function isSearchRequest(url: URL): boolean {
  if (url.pathname !== "/") return false;
  const p = url.searchParams;
  return p.has("lat") || p.has("lng") || p.has("q");
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    if (isSearchRequest(url) && BOT_UA.test(request.headers.get("user-agent") ?? "")) {
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
