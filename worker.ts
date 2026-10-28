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

import type { D1Database } from "@cloudflare/workers-types";
import { renderFacility, renderHojin, type DirectShell } from "./lib/direct";
// scripts/gen-direct-shell.mjs がビルド後に作る（CSS・アイコンの <link>）。無ければデプロイが失敗する
import SHELL_JSON from "./lib/direct-shell.generated.json";
const SHELL = SHELL_JSON as DirectShell;

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

// ---------------------------------------------------------------------------
// トップの地名検索（/?q=）の上限（2026-10-28）
// ---------------------------------------------------------------------------
// 地名が見つからない入力は D1 の place 表を全件（約6.2万行）読む。10/27 16時(UTC)から、bot を名乗らない
// 送り元の /?q= でこれが1日26回・約161万行になった（日次上限500万行の約3割）。結果は lib/db.ts で
// 入力ごとにキャッシュするが、毎回違う入力を大量に送られると防げないので、ここで回数と文字数に上限を掛ける。
// - 文字数：q が200文字を超える要求は検索しない（住所・地名の入力はこれより十分短い。place.key の最長は27文字）。
// - 回数：同じ IP（IPv6 は /64）から10分間に30回まで。超えたら 429。データセンターごとの Cache API で数える
//   （厳密な数ではないが、人の検索で届く回数ではない）。
const Q_MAX_CHARS = 200;
const SEARCH_RL_WINDOW_SEC = 600;
const SEARCH_RL_MAX = 30;

function clientKey(request: Request): string {
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  if (!ip.includes(":")) return ip;
  // IPv6 は先頭64ビット（4グループ）で数える
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : ip.split(":");
  return `${groups.slice(0, 4).map((g) => g.toLowerCase()).join(":")}::/64`;
}

async function overSearchLimit(request: Request, ctx: Ctx): Promise<boolean> {
  const who = clientKey(request);
  if (!who) return false;
  const win = Math.floor(Date.now() / 1000 / SEARCH_RL_WINDOW_SEC);
  const key = new Request(`https://kaigo-database.com/__rl/${encodeURIComponent(who)}/${win}`);
  try {
    const cache = (caches as unknown as { default: Cache }).default;
    const hit = await cache.match(key);
    const n = hit ? Number(await hit.text()) || 0 : 0;
    if (n >= SEARCH_RL_MAX) return true;
    ctx.waitUntil(
      cache
        .put(key, new Response(String(n + 1), { headers: { "cache-control": `public, max-age=${SEARCH_RL_WINDOW_SEC}` } }))
        .catch(() => {}),
    );
  } catch {
    // 数えられないときは通す
  }
  return false;
}

function searchRefused(status: number, message: string): Response {
  const body =
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="robots" content="noindex">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>検索を受け付けられません｜かいごDB</title></head>` +
    `<body style="font-family:sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.7">` +
    `<p>${message}</p><p><a href="/">トップへ戻る</a></p></body></html>`;
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "x-robots-tag": "noindex",
    "cache-control": "no-store",
  };
  if (status === 429) headers["retry-after"] = String(SEARCH_RL_WINDOW_SEC);
  return new Response(body, { status, headers });
}

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
  DB?: D1Database;
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
  if (url.pathname.startsWith("/_next/")) return null;
  if (/\.[a-z0-9]+$/i.test(url.pathname) && !CACHED_XML.has(url.pathname)) return null; // 静的ファイル等
  const k = new URL(url.toString());
  k.protocol = "https:"; // http と https で同じ HTML（canonical は常に https）
  k.searchParams.set("__v", env.CF_VERSION_METADATA?.id ?? "dev");
  return new Request(k.toString(), { method: "GET" });
}

// sitemap も同じ仕組みで保存する（2026-10-28）。D1 から毎回組み立てると CPU 66〜181ms かかり
// （10/25 の tail）、上限超過（503）で GSC の読み込みエラーになった可能性がある。中身は load とデプロイの
// ときしか変わらない。件数が極端に少ない（D1 不調時の可能性がある）ものは保存しない。
const CACHED_XML = new Set(["/sitemap.xml", "/hojin/sitemap.xml"]);
const XML_MIN_LOC = 1000;

function isCacheableBody(pathname: string, ct: string): boolean {
  if (CACHED_XML.has(pathname)) return ct.includes("xml");
  return ct.startsWith("text/html");
}

async function storeHtml(cache: Cache, key: Request, res: Response, pathname: string): Promise<void> {
  const body = await res.text();
  if (body.includes(ERROR_MARKER)) return;
  if (CACHED_XML.has(pathname) && body.split("<loc>").length - 1 < XML_MIN_LOC) return;
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

// ---------------------------------------------------------------------------
// 施設・法人ページの直接描画（2026-10-28・lib/direct.ts）
// ---------------------------------------------------------------------------
// Next の描画は1回 CPU 20〜40ms で、無料プランの上限 10ms を超えた分が 503 になる（超過の 99% がこの2種類）。
// クエリ無しの GET/HEAD（RSC 要求以外）は lib/direct.ts で HTML を組み立てて返す。表示部分は Next と同じ。
// 見つからない・失敗したときは null を返し、今までどおり Next（404・エラー画面）に回す。
// 確認用：要求ヘッダー `x-kaigo-render: next` を付けると Next で描画する（比較のため）。
const DIRECT_PATH = /^\/(facility|hojin)\/([^/]+)\/$/;

async function renderDirect(request: Request, url: URL, env: Env): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (url.search !== "" || isRscRequest(request) || !env.DB) return null;
  if (request.headers.get("x-kaigo-render") === "next") return null;
  const m = DIRECT_PATH.exec(url.pathname);
  if (!m) return null;
  let key: string;
  try {
    key = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  let html: string | null;
  try {
    html = m[1] === "facility" ? await renderFacility(env.DB, key, SHELL) : await renderHojin(env.DB, key, SHELL);
  } catch (e) {
    console.error("[direct] 失敗したため Next で描画します:", (e as Error).message);
    return null;
  }
  if (!html) return null;
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
      link: SHELL.linkHeader,
      vary: "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch",
      "x-direct-html": "1",
    },
  });
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
    const q = url.pathname === "/" ? url.searchParams.get("q") : null;
    if (q && q.trim()) {
      if (q.length > Q_MAX_CHARS) {
        return searchRefused(400, `入力が長すぎます（${Q_MAX_CHARS}文字まで）。住所・地名を短くして検索してください。`);
      }
      if (await overSearchLimit(request, ctx)) {
        return searchRefused(429, "短時間に多くの検索が行われたため、一時的に検索を受け付けていません。10分ほどおいてから再度お試しください。");
      }
    }
    if (url.searchParams.has("_rsc") && !isRscRequest(request) && (request.method === "GET" || request.method === "HEAD")) {
      const stripped = stripRscParam(url);
      request = new Request(stripped.toString(), request);
      url = stripped;
    }
    const direct = await renderDirect(request, url, env);
    if (direct) return direct;

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
    if (request.method === "GET" && res.status === 200 && isCacheableBody(url.pathname, ct) && !res.headers.has("set-cookie")) {
      ctx.waitUntil(storeHtml(cache, key, res.clone(), url.pathname).catch(() => {}));
    }
    return res;
  },
};
