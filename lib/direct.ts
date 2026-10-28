// 施設ページ（/facility/[id]/）・法人ページ（/hojin/[slug]/）を、Next を通さずに worker.ts で直接 HTML にする。
//
// 理由（2026-10-24 点検 §4・10/28 okina 承認）：無料プランの CPU 上限は1要求 10ms。Next の描画（RSC → HTML）は
// 施設ページで p50 約34ms・法人ページで約20ms かかり、bot の巡回はほぼ毎回別の URL なので HTML キャッシュも
// 効かない（命中 約5%）。超過の 99% がこの2種類のページだった（10/28 tail）。ここでは文字列を組み立てるだけにする。
//
// 出力は Next の描画結果と同じ HTML にする（スクリプトを除いた部分がバイト単位で一致することを確認してから出す）。
// - 対応する JSX：app/facility/[id]/page.tsx・app/hojin/[slug]/page.tsx・app/layout.tsx・components/SiteHeader.tsx・
//   Footer.tsx・Breadcrumb.tsx・FacilityTable.tsx・SourceNote.tsx。**これらを変えたらここも同じように直すこと。**
// - 違うのは Next の実行用スクリプト（ブラウザ内遷移用のデータ）が無いことだけ。どちらのページにも
//   クライアント部品は無いので、表示・リンク・構造化データは同じ。リンクは通常のページ遷移になる。
// - 見つからない・D1 に失敗した・想定外の値のときは null を返し、worker.ts は今までどおり Next に回す
//   （404・エラー画面は Next のものをそのまま使う）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Corporation, Facility } from "./db";
import { isValidJapanLatLng } from "./geo";
import { facilityRobots, isIndexableFacility, listRobots, type RobotsDirective } from "./indexing";
import { CAPACITY_OK_SQL } from "./capacity";
import {
  abs,
  LICENSE_NAME,
  LICENSE_URL,
  NO_DATA,
  orNoData,
  seg,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  SOURCE_NAME,
  SOURCE_URL,
} from "./site";

/** ビルドごとに変わる head のリンク（CSS・アイコン）。scripts/gen-direct-shell.mjs が作る */
export interface DirectShell {
  /** <link rel="stylesheet" …/> などをそのまま連結したもの */
  styles: string;
  /** <link rel="icon" …/> などをそのまま連結したもの */
  icons: string;
  /** HTTP の Link ヘッダー（CSS の preload）。Next の応答と同じ値 */
  linkHeader: string;
}

// ---------------------------------------------------------------------------
// React の出力に合わせた小さな部品
// ---------------------------------------------------------------------------

// React（react-dom/server）の escapeTextForBrowser と同じ置き換え
function esc(v: unknown): string {
  const s = String(v);
  if (!/["&'<>]/.test(s)) return s;
  return s.replace(/["&'<>]/g, (c) =>
    c === '"' ? "&quot;" : c === "&" ? "&amp;" : c === "'" ? "&#x27;" : c === "<" ? "&lt;" : "&gt;",
  );
}

/**
 * 子要素の並び。React は隣り合う文字列ノードの間に `<!-- -->` を入れる（null・false・空文字は何も出さず、
 * 隣接の判定にも影響しない）。文字列は esc し、Html（タグ）はそのまま出す。
 */
class Html {
  constructor(readonly s: string) {}
}
type Child = string | number | Html | null | undefined | false;
function kids(...children: Child[]): string {
  let out = "";
  let lastText = false;
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === "") continue;
    if (c instanceof Html) {
      out += c.s;
      lastText = false;
    } else {
      if (lastText) out += "<!-- -->";
      out += esc(c);
      lastText = true;
    }
  }
  return out;
}
const raw = (s: string) => new Html(s);

/** next/link の <a>：href 以外の属性を JSX の順に並べ、href を最後に置く */
function link(href: string, cls: string, inner: string, rel?: string): Html {
  return raw(`<a${rel ? ` rel="${esc(rel)}"` : ""} class="${esc(cls)}" href="${esc(href)}">${inner}</a>`);
}

const noData = raw(`<span class="text-muted-2">${NO_DATA}</span>`);

function robotsContent(r: RobotsDirective): string {
  return `${r.index ? "index" : "noindex"}, ${r.follow ? "follow" : "nofollow"}`;
}

function jsonLdScript(obj: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

// ---------------------------------------------------------------------------
// レイアウト（app/layout.tsx・SiteHeader・Footer）
// ---------------------------------------------------------------------------

const OG_IMAGE = "/og-default.png?v=20261014";
const NAV = [
  { href: "/", label: "住所から探す" },
  { href: "/type/", label: "サービス種別" },
  { href: "/area/", label: "エリア" },
  { href: "/hojin/", label: "運営法人" },
  { href: "/ranking/", label: "並べ替えて探す" },
  { href: "/data/", label: "データについて" },
];
const FOOTER_NAV = [
  { href: "/", label: "トップ" },
  { href: "/type/", label: "サービス種別一覧" },
  { href: "/area/", label: "都道府県一覧" },
  { href: "/hojin/", label: "運営法人一覧" },
  { href: "/ranking/", label: "並べ替えて探す" },
  { href: "/data/", label: "データについて（充足率）" },
];

function head(shell: DirectShell, m: { title: string; description: string; robots: RobotsDirective; canonical: string }): string {
  const title = `${m.title}｜${SITE_NAME}`;
  const ogAlt = `${SITE_NAME}｜全国の介護施設・事業所データベース`;
  return (
    `<head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    shell.styles +
    `<title>${esc(title)}</title>` +
    `<meta name="description" content="${esc(m.description)}"/>` +
    `<meta name="robots" content="${robotsContent(m.robots)}"/>` +
    `<link rel="canonical" href="${esc(m.canonical)}"/>` +
    `<meta property="og:title" content="${esc(title)}"/>` +
    `<meta property="og:description" content="${esc(m.description)}"/>` +
    `<meta property="og:site_name" content="${esc(SITE_NAME)}"/>` +
    `<meta property="og:locale" content="ja_JP"/>` +
    `<meta property="og:image" content="${esc(abs(OG_IMAGE))}"/>` +
    `<meta property="og:image:width" content="1200"/>` +
    `<meta property="og:image:height" content="630"/>` +
    `<meta property="og:image:alt" content="${esc(ogAlt)}"/>` +
    `<meta property="og:type" content="website"/>` +
    `<meta name="twitter:card" content="summary_large_image"/>` +
    `<meta name="twitter:title" content="${esc(title)}"/>` +
    `<meta name="twitter:description" content="${esc(m.description)}"/>` +
    `<meta name="twitter:image" content="${esc(abs(OG_IMAGE))}"/>` +
    shell.icons +
    `</head>`
  );
}

function siteHeader(): string {
  return (
    `<header class="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">` +
    `<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">` +
    link(
      "/",
      "flex items-baseline gap-2",
      `<span class="text-lg font-bold tracking-tight text-accent">${esc(SITE_NAME)}</span>` +
        `<span class="text-[11px] font-normal text-muted">${esc(SITE_TAGLINE)}</span>`,
    ).s +
    `<nav class="ml-auto"><ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs">` +
    NAV.map((n) => `<li>${link(n.href, "text-muted hover:text-accent hover:underline", esc(n.label)).s}</li>`).join("") +
    `</ul></nav></div></header>`
  );
}

function sourceAnchor(): Html {
  return raw(
    `<a href="${esc(SOURCE_URL)}" rel="noopener noreferrer" target="_blank" class="underline hover:text-accent">${esc(SOURCE_NAME)}</a>`,
  );
}
function licenseAnchor(): Html {
  return raw(
    `<a href="${esc(LICENSE_URL)}" rel="license noopener noreferrer" target="_blank" class="underline hover:text-accent">${esc(LICENSE_NAME)}</a>`,
  );
}

function footer(): string {
  return (
    `<footer class="mt-16 border-t border-line bg-surface"><div class="mx-auto max-w-6xl px-4 py-8 text-xs text-muted">` +
    `<ul class="flex flex-wrap gap-x-5 gap-y-2">` +
    FOOTER_NAV.map((n) => `<li>${link(n.href, "hover:text-accent hover:underline", esc(n.label)).s}</li>`).join("") +
    `</ul>` +
    `<p class="mt-5 leading-relaxed">` +
    kids(
      "掲載情報は",
      " ",
      sourceAnchor(),
      " ",
      "の公表データ（",
      licenseAnchor(),
      "）にもとづいています。口コミ・独自の評価・ランキングは掲載していません。 ご利用前に、各施設に最新の状況をご確認ください。",
    ) +
    `</p>` +
    `<p class="mt-3 text-muted-2">${kids("© ", new Date().getFullYear(), " ", SITE_NAME)}</p>` +
    `</div></footer>`
  );
}

function page(shell: DirectShell, meta: Parameters<typeof head>[1], main: string): string {
  return (
    `<!DOCTYPE html><html lang="ja">` +
    head(shell, meta) +
    `<body><div hidden=""><!--$--><!--/$--></div>` +
    jsonLdScript({ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: SITE_URL, inLanguage: "ja" }) +
    siteHeader() +
    `<div class="mx-auto max-w-6xl px-4 py-6"><main>${main}</main><!--$--><!--/$--></div>` +
    footer() +
    `</body></html>`
  );
}

// ---------------------------------------------------------------------------
// 共通部品（Breadcrumb・FacilityTable・SourceNote）
// ---------------------------------------------------------------------------

interface Crumb {
  name: string;
  href?: string;
}

function breadcrumb(items: Crumb[]): string {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.href ? { item: `${SITE_URL}${c.href}` } : {}),
    })),
  };
  return (
    jsonLdScript(jsonLd) +
    `<nav aria-label="パンくずリスト" class="mb-5"><ol class="flex flex-wrap items-center gap-1 text-xs text-muted">` +
    items
      .map(
        (c, i) =>
          `<li class="flex items-center gap-1">` +
          (c.href
            ? link(c.href, "hover:text-accent hover:underline", kids(c.name)).s
            : `<span class="font-medium text-ink" aria-current="page">${kids(c.name)}</span>`) +
          (i < items.length - 1 ? `<span class="text-line-strong">›</span>` : "") +
          `</li>`,
      )
      .join("") +
    `</ol></nav>`
  );
}

function sourceNote(acquiredOn: string | null | undefined): string {
  return (
    `<p class="mt-8 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">` +
    kids("出典：", sourceAnchor(), "（", licenseAnchor(), "）", acquiredOn ? `／取得日 ${acquiredOn}` : "／取得日 記載なし") +
    `<br/>当サイトは公表データをそのまま掲載しています。記載のない項目は「記載なし」と表示し、推測値による補完は行っていません。</p>`
  );
}

function facilityTable(rows: Facility[], opt: { hideCity?: boolean; hideCorp?: boolean }): string {
  if (rows.length === 0) {
    return `<p class="card px-4 py-8 text-center text-sm text-muted">該当する施設はありません。</p>`;
  }
  const cap = (f: Facility) => (f.capacity == null ? noData : `${f.capacity}人`);
  let s =
    `<div class="hidden md:block"><table class="w-full border-collapse text-sm"><thead>` +
    `<tr class="border-b border-line-strong text-left text-xs text-muted">` +
    `<th scope="col" class="py-2 pr-3 font-medium">事業所名</th>` +
    `<th scope="col" class="w-48 py-2 pr-3 font-medium">種別</th>` +
    (opt.hideCity ? "" : `<th scope="col" class="w-40 py-2 pr-3 font-medium">市区町村</th>`) +
    `<th scope="col" class="w-20 py-2 pr-3 text-right font-medium">定員</th>` +
    (opt.hideCorp ? "" : `<th scope="col" class="w-56 py-2 font-medium">法人</th>`) +
    `</tr></thead><tbody>`;
  for (const f of rows) {
    const ch = f.pref_slug && f.city_slug ? `/area/${seg(f.pref_slug)}/${seg(f.city_slug)}/` : null;
    s +=
      `<tr class="border-b border-line align-top hover:bg-tint">` +
      `<td class="py-2 pr-3">${link(`/facility/${seg(f.id)}/`, "font-medium text-ink underline-offset-2 hover:text-accent hover:underline", kids(f.name)).s}</td>` +
      `<td class="py-2 pr-3 text-muted">${link(`/type/${seg(f.service_type_slug)}/`, "hover:text-accent hover:underline", kids(f.service_type)).s}</td>` +
      (opt.hideCity
        ? ""
        : `<td class="py-2 pr-3 text-muted">${
            ch ? link(ch, "hover:text-accent hover:underline", kids(f.city || NO_DATA)).s : kids(f.city || NO_DATA)
          }</td>`) +
      `<td class="py-2 pr-3 text-right tabular-nums">${kids(cap(f))}</td>` +
      (opt.hideCorp
        ? ""
        : `<td class="py-2 text-muted">${
            f.corporation_slug && f.corporation_name
              ? link(`/hojin/${seg(f.corporation_slug)}/`, "hover:text-accent hover:underline", kids(f.corporation_name)).s
              : noData.s
          }</td>`) +
      `</tr>`;
  }
  s += `</tbody></table></div><ul class="space-y-2 md:hidden">`;
  for (const f of rows) {
    s +=
      `<li class="card p-3">` +
      link(`/facility/${seg(f.id)}/`, "font-medium text-ink underline-offset-2 hover:underline", kids(f.name)).s +
      `<dl class="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">` +
      `<dt class="text-muted">種別</dt><dd>${kids(f.service_type)}</dd>` +
      `<dt class="text-muted">市区町村</dt><dd>${kids([f.prefecture, f.city].filter(Boolean).join(" ") || NO_DATA)}</dd>` +
      `<dt class="text-muted">定員</dt><dd class="tabular-nums">${kids(cap(f))}</dd>` +
      `<dt class="text-muted">法人</dt><dd>${kids(f.corporation_name || noData)}</dd>` +
      `</dl></li>`;
  }
  s += `</ul>`;
  return s;
}

// ---------------------------------------------------------------------------
// D1（lib/db.ts と同じ SQL・同じキャッシュ）
// ---------------------------------------------------------------------------

const FACILITY_COLS =
  "id, jigyosho_no, name, service_type, service_type_slug, is_residential, postal_code, prefecture, pref_slug, city, city_slug, address, lat, lng, tel, corporate_number, corporation_name, corporation_slug, " +
  `CASE WHEN ${CAPACITY_OK_SQL} THEN capacity END AS capacity, ` +
  "open_days, official_url, acquired_on, is_indexable";
const CORP_COLS = "slug, corporate_number, name, facility_count, pref_count, name_variants";

// lib/db.ts の cachedAgg と同じ Cache API のキー・形式（`${SITE_URL}/__agg/<key>`・x-agg-at）を読み書きする。
// Next 側と値を共有するため、キーと形式を変えるときは両方そろえること。
const AGG_TTL_SEC = 6 * 60 * 60;
const AGG_STALE_SEC = 7 * 24 * 60 * 60;
const memo = new Map<string, { at: number; value: unknown }>();
const MEMO_MAX = 400;

async function cachedAgg<T>(key: string, fn: () => Promise<T>, isEmpty: (v: T) => boolean): Promise<T> {
  const now = Date.now();
  const m = memo.get(key);
  if (m && now - m.at < AGG_TTL_SEC * 1000) return m.value as T;
  let stale: { value: T } | undefined = m ? { value: m.value as T } : undefined;
  const cacheStore = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const req = new Request(`${SITE_URL}/__agg/${encodeURIComponent(key)}`);
  if (cacheStore) {
    try {
      const hit = await cacheStore.match(req);
      if (hit) {
        const at = Number(hit.headers.get("x-agg-at")) || now;
        const value = (await hit.json()) as T;
        if (now - at < AGG_TTL_SEC * 1000) {
          memo.delete(key);
          memo.set(key, { at, value });
          return value;
        }
        stale = { value };
      }
    } catch {
      // キャッシュの不調は無視して D1 を読む
    }
  }
  let value: T;
  try {
    value = await fn();
  } catch (e) {
    if (stale) return stale.value;
    throw e;
  }
  if (isEmpty(value) && stale) return stale.value;
  if (!isEmpty(value)) {
    memo.delete(key);
    memo.set(key, { at: now, value });
    while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
    if (cacheStore) {
      try {
        await cacheStore.put(
          req,
          new Response(JSON.stringify(value), {
            headers: {
              "content-type": "application/json",
              "cache-control": `public, max-age=${AGG_STALE_SEC}`,
              "x-agg-at": String(now),
            },
          }),
        );
      } catch {
        // 書けなくても表示は続ける
      }
    }
  }
  return value;
}

async function all<T>(db: D1Database, sql: string, params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return (r.results ?? []) as T[];
}

function getMeta(db: D1Database): Promise<Record<string, string>> {
  return cachedAgg(
    "meta",
    async () => {
      const rows = await all<{ key: string; value: string | null }>(db, "SELECT key, value FROM meta", []);
      const out: Record<string, string> = {};
      for (const r of rows) if (r.value != null) out[r.key] = r.value;
      return out;
    },
    (v) => Object.keys(v).length === 0,
  );
}

async function sameCity(db: D1Database, prefSlug: string, citySlug: string, excludeId: string, limit = 20): Promise<Facility[]> {
  const rows = await cachedAgg(
    `sameCity:${prefSlug}/${citySlug}/${limit + 1}`,
    () =>
      all<Facility>(
        db,
        `SELECT ${FACILITY_COLS} FROM facility
         WHERE pref_slug = ? AND city_slug = ?
         ORDER BY is_indexable DESC, name LIMIT ?`,
        [prefSlug, citySlug, limit + 1],
      ),
    (v) => v.length === 0,
  );
  return rows.filter((r) => r.id !== excludeId).slice(0, limit);
}

// ---------------------------------------------------------------------------
// 施設ページ（app/facility/[id]/page.tsx）
// ---------------------------------------------------------------------------

function facilityJsonLd(f: Facility) {
  const hasGeo = isValidJapanLatLng(f.lat, f.lng);
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: f.name,
    url: abs(`/facility/${seg(f.id)}/`),
    additionalType: f.service_type,
    identifier: f.jigyosho_no,
  };
  if (f.address || f.prefecture || f.city || f.postal_code) {
    node.address = {
      "@type": "PostalAddress",
      addressCountry: "JP",
      ...(f.prefecture ? { addressRegion: f.prefecture } : {}),
      ...(f.city ? { addressLocality: f.city } : {}),
      ...(f.address ? { streetAddress: f.address } : {}),
      ...(f.postal_code ? { postalCode: f.postal_code } : {}),
    };
  }
  if (hasGeo) node.geo = { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lng };
  if (f.tel) node.telephone = f.tel;
  if (f.official_url) node.sameAs = [f.official_url];
  if (f.capacity != null) node.maximumAttendeeCapacity = f.capacity;
  if (f.corporation_name) {
    node.additionalProperty = [{ "@type": "PropertyValue", name: "運営法人", value: f.corporation_name }];
  }
  return node;
}

function row(label: string, children: string): string {
  return (
    `<div class="grid grid-cols-1 gap-0.5 border-b border-line py-2 sm:grid-cols-[9rem_1fr] sm:gap-3">` +
    `<dt class="text-xs text-muted sm:pt-0.5">${esc(label)}</dt><dd class="text-sm break-words">${children}</dd></div>`
  );
}

export async function renderFacility(db: D1Database, id: string, shell: DirectShell): Promise<string | null> {
  const f = (await db.prepare(`SELECT ${FACILITY_COLS} FROM facility WHERE id = ?`).bind(id).first<Facility>()) ?? undefined;
  if (!f) return null;
  const [meta, neighbors] = await Promise.all([
    getMeta(db),
    f.pref_slug && f.city_slug ? sameCity(db, f.pref_slug, f.city_slug, f.id, 20) : Promise.resolve([] as Facility[]),
  ]);

  const where = [f.prefecture, f.city].filter(Boolean).join("");
  const metaInfo = {
    title: `${f.name}（${where}）｜${f.service_type}`,
    description: `${where}の${f.service_type}「${f.name}」の公表情報です。住所・電話番号・運営法人${f.capacity != null ? `・定員${f.capacity}人` : ""}を、厚生労働省の公表データにもとづいて掲載しています。`,
    canonical: abs(`/facility/${seg(f.id)}/`),
    robots: facilityRobots(f),
  };
  const hasGeo = isValidJapanLatLng(f.lat, f.lng);
  const indexable = isIndexableFacility(f);

  const crumbs: Crumb[] = [
    { name: "ホーム", href: "/" },
    { name: "都道府県から探す", href: "/area/" },
    ...(f.pref_slug && f.prefecture ? [{ name: f.prefecture, href: `/area/${seg(f.pref_slug)}/` }] : []),
    ...(f.pref_slug && f.city_slug && f.city ? [{ name: f.city, href: `/area/${seg(f.pref_slug)}/${seg(f.city_slug)}/` }] : []),
    { name: f.name },
  ];

  let corp: string;
  if (f.corporation_name) {
    corp = f.corporation_slug
      ? link(`/hojin/${seg(f.corporation_slug)}/`, "text-accent hover:underline", kids(f.corporation_name)).s
      : kids(f.corporation_name, raw(`<span class="ml-2 text-[11px] text-muted-2">法人番号の記載がないため法人ページはありません</span>`));
  } else {
    corp = noData.s;
  }

  let main =
    jsonLdScript(facilityJsonLd(f)) +
    breadcrumb(crumbs) +
    `<p class="text-xs text-muted">${kids(f.service_type)}</p>` +
    `<h1 class="mb-4">${kids(f.name)}</h1>` +
    `<dl class="mb-6 border-t border-line">` +
    row("サービス種別", link(`/type/${seg(f.service_type_slug)}/`, "text-accent hover:underline", kids(f.service_type)).s) +
    row(
      "所在地",
      f.address
        ? kids(f.postal_code ? `〒${f.postal_code} ` : "", f.address)
        : kids([f.prefecture, f.city].filter(Boolean).join("") || noData),
    ) +
    row(
      "電話番号",
      f.tel ? `<a href="${esc(`tel:${f.tel.replace(/[^0-9+]/g, "")}`)}" class="text-accent hover:underline">${kids(f.tel)}</a>` : noData.s,
    ) +
    row("定員", f.capacity != null ? `<span class="tabular-nums">${kids(f.capacity, "人")}</span>` : noData.s) +
    row("利用可能曜日", orNoData(f.open_days) === NO_DATA ? noData.s : kids(f.open_days)) +
    row("運営法人", corp) +
    row("法人番号", f.corporate_number ? `<span class="tabular-nums">${kids(f.corporate_number)}</span>` : noData.s) +
    row(
      "公式サイト",
      f.official_url
        ? `<a href="${esc(f.official_url)}" rel="nofollow noopener noreferrer" target="_blank" class="break-all text-accent hover:underline">${kids(f.official_url)}</a>`
        : noData.s,
    ) +
    row(
      "緯度・経度",
      hasGeo
        ? `<span class="tabular-nums">${kids(f.lat, ", ", f.lng)}</span>` +
            `<a href="${esc(`https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lng}`)}" rel="nofollow noopener noreferrer" target="_blank" class="ml-3 text-xs text-accent hover:underline">地図で表示</a>` +
            link(`/?lat=${f.lat}&lng=${f.lng}&radius=3&sort=distance`, "ml-3 text-xs text-accent hover:underline", "周辺3km以内を検索", "nofollow").s
        : noData.s,
    ) +
    row("事業所番号", orNoData(f.jigyosho_no) === NO_DATA ? noData.s : `<span class="tabular-nums">${kids(f.jigyosho_no)}</span>`) +
    `</dl>`;

  if (!indexable) {
    main +=
      `<p class="mb-6 note px-3 py-2 text-xs text-muted">この施設は公表データに定員・公式URLの記載がないため、掲載している項目が限られています （当サイトの方針により検索エンジンには登録していません）。</p>`;
  }

  if (neighbors.length > 0) {
    main +=
      `<section class="mb-6"><h2 class="mb-3">${kids("同じ", f.city ?? "市区町村", "の施設", raw(`<span class="ml-2 text-xs font-normal text-muted">${kids(neighbors.length, "件")}</span>`))}</h2>` +
      facilityTable(neighbors, { hideCity: true }) +
      (f.pref_slug && f.city_slug
        ? `<p class="mt-3 text-xs">${link(`/area/${seg(f.pref_slug)}/${seg(f.city_slug)}/`, "text-accent hover:underline", kids(f.prefecture, f.city, "の施設一覧 →")).s}</p>`
        : "") +
      `</section>`;
  }

  main += sourceNote(f.acquired_on ?? meta.acquired_on);
  return page(shell, metaInfo, main);
}

// ---------------------------------------------------------------------------
// 法人ページ（app/hojin/[slug]/page.tsx）
// ---------------------------------------------------------------------------

export async function renderHojin(db: D1Database, slug: string, shell: DirectShell): Promise<string | null> {
  const c = (await db.prepare(`SELECT ${CORP_COLS} FROM corporation WHERE slug = ?`).bind(slug).first<Corporation>()) ?? undefined;
  if (!c) return null;
  const [meta, rows] = await Promise.all([
    getMeta(db),
    all<Facility>(db, `SELECT ${FACILITY_COLS} FROM facility WHERE corporation_slug = ?
       ORDER BY prefecture, city, name LIMIT ?`, [slug, 300]),
  ]);

  const metaInfo = {
    title: `${c.name}が運営する介護事業所一覧`,
    description: `${c.name}が運営する介護事業所${c.facility_count.toLocaleString()}件の一覧です。所在地・サービス種別・定員を、厚生労働省の公表データにもとづいて掲載しています。`,
    canonical: abs(`/hojin/${seg(slug)}/`),
    robots: listRobots(c.facility_count),
  };
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: c.name,
    url: abs(`/hojin/${seg(slug)}/`),
    identifier: { "@type": "PropertyValue", name: "法人番号", value: c.corporate_number },
  };
  const types = new Map<string, number>();
  for (const r of rows) types.set(r.service_type, (types.get(r.service_type) ?? 0) + 1);

  const stat = (label: string, value: string) =>
    `<div><dt class="text-xs text-muted">${esc(label)}</dt><dd class="tabular-nums text-lg font-bold">${kids(value)}</dd></div>`;

  let main =
    jsonLdScript(jsonLd) +
    breadcrumb([{ name: "ホーム", href: "/" }, { name: c.name }]) +
    `<h1 class="mb-3">${kids(c.name, "が運営する介護事業所")}</h1>` +
    `<dl class="mb-5 flex flex-wrap gap-x-8 gap-y-2 border-y border-line py-3 text-sm">` +
    stat("施設数", c.facility_count.toLocaleString()) +
    stat("展開都道府県", c.pref_count.toLocaleString()) +
    stat("サービス種別", types.size.toLocaleString()) +
    stat("法人番号", c.corporate_number) +
    `</dl>` +
    facilityTable(rows, { hideCorp: true });

  if (c.facility_count > rows.length) {
    main += `<p class="mt-3 text-xs text-muted">${kids("全", c.facility_count.toLocaleString(), "件のうち", rows.length.toLocaleString(), "件を表示しています。")}</p>`;
  }

  main +=
    `<p class="mt-4 text-xs leading-relaxed text-muted">` +
    kids(
      "このページでは、法人名ではなく",
      raw(`<strong>${kids("法人番号（", c.corporate_number, "）")}</strong>`),
      "にもとづいて施設をまとめています。 同名の別法人は別のページに掲載し、表記の異なる同一法人は1ページにまとめて掲載しています。",
      ...(c.name_variants > 1
        ? [" ", "出典データではこの法人の名称が", c.name_variants, "通りの表記で登録されていたため、 最も多く使用されていた表記を見出しに採用しています。"]
        : []),
      " ",
      "法人番号の記載がない施設（掲載全体の約1.7%）は、いずれの法人ページにも含まれません。",
    ) +
    `</p>` +
    sourceNote(meta.acquired_on);

  return page(shell, metaInfo, main);
}
