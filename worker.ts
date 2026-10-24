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

// ---------------------------------------------------------------------------
// 描画済み HTML のキャッシュ（Cache API・データセンターごと・無料）
// ---------------------------------------------------------------------------
// Next の描画（RSC → HTML）は1回あたり CPU 20〜60ms かかり、無料プランの上限（10ms）を超えた分が
// exceededCpu（503）になっていた（10/22 で全体の約4.6%）。表示内容は load（データ投入）と
// デプロイのときしか変わらないので、同じ URL の2回目以降は描画せずに保存済みの HTML を返す。
// - 対象：GET/HEAD・RSC 以外（ブラウザ内遷移の ?_rsc= は対象外）・トップの検索（?lat/lng/q）以外・200 の HTML のみ。
// - キーにデプロイのバージョン ID を入れる（デプロイすると古い HTML は使われない）。データを load したら ship すること。
// - D1 障害時の画面（error.tsx）や Set-Cookie 付きは保存しない。
// - 返す HTML・ヘッダーは描画したときと同じ（cache-control も元の値に戻す）。x-html-cache だけ足す。
const HTML_TTL_SEC = 7 * 24 * 3600;
const ERROR_MARKER = "データベースに一時的に接続できませんでした";

interface Env {
  CF_VERSION_METADATA?: { id?: string };
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

// 本物の RSC 要求（ブラウザ内遷移・プリフェッチ）は必ず rsc 等のヘッダーを付ける。これらはキャッシュしない。
function isRscRequest(request: Request): boolean {
  const h = request.headers;
  return h.has("rsc") || h.has("next-router-state-tree") || h.has("next-router-prefetch") || h.has("next-router-segment-prefetch");
}

// 2026-10-23 以降、Microsoft（AS8075）のクローラーが `?_rsc=…` 付き URL をヘッダーなしの普通の GET で
// 取りに来ている（10/24 の tail で全体の34%・CPU 超過の54%）。ヘッダーが無いと Next は通常の HTML を描画する
// （表示部分は `_rsc` なしの URL と同じで、違うのは Next 内部データに `?_rsc=…` が入ることだけ）。
// この要求は `_rsc` を外した URL として扱い、同じ保存済み HTML を返す（無ければ `_rsc` を外して描画・保存）。
function stripRscParam(url: URL): URL {
  const u = new URL(url.toString());
  u.searchParams.delete("_rsc");
  return u;
}

function htmlCacheKey(request: Request, url: URL, env: Env): Request | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (isRscRequest(request)) return null;
  if (url.searchParams.has("_rsc") || isSearchRequest(url)) return null;
  if (url.pathname.startsWith("/_next/") || /\.[a-z0-9]+$/i.test(url.pathname)) return null; // 静的ファイル・sitemap.xml 等
  const k = new URL(url.toString());
  k.protocol = "https:"; // http と https で同じ HTML（canonical は常に https）
  k.searchParams.set("__v", env.CF_VERSION_METADATA?.id ?? "dev");
  return new Request(k.toString(), { method: "GET" });
}

async function storeHtml(cache: Cache, key: Request, res: Response): Promise<void> {
  const body = await res.text();
  if (body.includes(ERROR_MARKER)) return;
  const headers = new Headers(res.headers);
  headers.set("x-orig-cache-control", res.headers.get("cache-control") ?? "");
  headers.set("cache-control", `public, max-age=${HTML_TTL_SEC}`);
  // キーで RSC を除外済み。Cache API に Vary を解釈させないよう、元の値は別名で保存して返すときに戻す
  headers.set("x-orig-vary", res.headers.get("vary") ?? "");
  headers.delete("vary");
  await cache.put(key, new Response(body, { status: 200, headers }));
}

function fromCache(hit: Response, isHead: boolean): Response {
  const headers = new Headers(hit.headers);
  const cc = headers.get("x-orig-cache-control");
  const vary = headers.get("x-orig-vary");
  headers.delete("x-orig-cache-control");
  headers.delete("x-orig-vary");
  if (cc) headers.set("cache-control", cc);
  else headers.delete("cache-control");
  if (vary) headers.set("vary", vary);
  headers.delete("age");
  headers.delete("cf-cache-status");
  headers.set("x-html-cache", "HIT");
  return new Response(isHead ? null : hit.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    let url = new URL(request.url);
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
    if (url.searchParams.has("_rsc") && !isRscRequest(request) && (request.method === "GET" || request.method === "HEAD")) {
      const stripped = stripRscParam(url);
      request = new Request(stripped.toString(), request);
      url = stripped;
    }
    const key = htmlCacheKey(request, url, env);
    if (!key) return handler.fetch(request, env, ctx);

    const cache = (caches as unknown as { default: Cache }).default;
    try {
      const hit = await cache.match(key);
      if (hit) return fromCache(hit, request.method === "HEAD");
    } catch {
      // Cache API が使えなくても描画して返す
    }

    const res: Response = await handler.fetch(request, env, ctx);
    const ct = res.headers.get("content-type") ?? "";
    if (request.method === "GET" && res.status === 200 && ct.startsWith("text/html") && !res.headers.has("set-cookie")) {
      ctx.waitUntil(storeHtml(cache, key, res.clone()).catch(() => {}));
    }
    return res;
  },
};
