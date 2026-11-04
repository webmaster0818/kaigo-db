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
import { GSI_CREDIT_HTML, detailMap, mapEnabled, thumbMap } from "./gsimap";
import { facilityRobots, isIndexableFacility, listRobots, type RobotsDirective } from "./indexing";
import { CAPACITY_OK_SQL } from "./capacity";
import { NOT_A_RECOMMENDATION } from "./ranking";
import { SLUG_TO_PREF } from "./slug";
import { TYPE_GUIDE_CAVEAT, TYPE_GUIDES } from "./typeGuide";
import {
  CAPACITY_BANDS,
  qualifiesTypeCity,
  TYPE_CITY_LABELS,
  TYPE_CITY_MIN_INDEXABLE,
  typeCityPath,
  type TypeCityCombo,
} from "./typeCity";
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
  /** <html> の class（app/layout.tsx の next/font が付ける書体の変数） */
  htmlClass?: string;
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

// components/LogoMark.tsx と同じ図形（変えるときは両方そろえる）
const LOGO_MARK =
  `<svg viewBox="20 34 472 472" class="h-9 w-9 shrink-0 md:h-10 md:w-10" aria-hidden="true">` +
  `<circle cx="256" cy="270" r="230" fill="#FDF1E7"/>` +
  `<path d="M256,430 C150,360 110,300 110,250 C110,200 150,170 190,170 C226,170 248,192 256,214" fill="none" stroke="#C0551F" stroke-width="36" stroke-linecap="round"/>` +
  `<path d="M256,430 C362,360 402,300 402,250 C402,200 362,170 322,170 C286,170 264,192 256,214" fill="none" stroke="#4F7C5A" stroke-width="36" stroke-linecap="round"/>` +
  `<circle cx="168" cy="104" r="40" fill="#C0551F"/><circle cx="344" cy="110" r="34" fill="#4F7C5A"/></svg>`;

function siteHeader(): string {
  return (
    `<header class="sticky top-0 z-20 border-b border-line-strong bg-paper/95 backdrop-blur">` +
    `<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:py-4">` +
    link(
      "/",
      "flex items-center gap-3",
      LOGO_MARK +
        `<span class="font-display text-xl font-bold tracking-wider text-ink">${esc(SITE_NAME)}</span>` +
        `<span class="text-[11px] tracking-wider text-muted">${esc(SITE_TAGLINE)}</span>`,
    ).s +
    `<nav class="-mx-4 w-full overflow-x-auto px-4 md:mx-0 md:ml-auto md:w-auto md:px-0"><ul class="flex gap-x-5 whitespace-nowrap text-[13px] md:flex-wrap">` +
    NAV.map((n) => `<li>${link(n.href, "text-muted underline-offset-4 hover:text-ink hover:underline", esc(n.label)).s}</li>`).join("") +
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
    `<footer class="mt-24 border-t border-line-strong bg-surface"><div class="mx-auto max-w-6xl px-4 py-12 text-xs text-muted">` +
    `<ul class="flex flex-wrap gap-x-6 gap-y-3 text-[13px]">` +
    FOOTER_NAV.map((n) => `<li>${link(n.href, "underline-offset-4 hover:text-ink hover:underline", esc(n.label)).s}</li>`).join("") +
    `</ul>` +
    `<p class="mt-8 max-w-3xl border-t border-line pt-6 leading-relaxed">` +
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
    `<p class="mt-4 tracking-wider text-muted-2">${kids("© ", new Date().getFullYear(), " ", SITE_NAME)}</p>` +
    `</div></footer>`
  );
}

function page(shell: DirectShell, meta: Parameters<typeof head>[1], main: string): string {
  return (
    `<!DOCTYPE html><html lang="ja"${shell.htmlClass ? ` class="${esc(shell.htmlClass)}"` : ""}>` +
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
    `<nav aria-label="パンくずリスト" class="mb-8"><ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">` +
    items
      .map(
        (c, i) =>
          `<li class="flex items-center gap-2">` +
          (c.href
            ? link(c.href, "underline-offset-4 hover:text-ink hover:underline", kids(c.name)).s
            : `<span class="font-medium text-ink" aria-current="page">${kids(c.name)}</span>`) +
          (i < items.length - 1 ? `<span class="text-muted-2">›</span>` : "") +
          `</li>`,
      )
      .join("") +
    `</ol></nav>`
  );
}

function sourceNote(acquiredOn: string | null | undefined): string {
  return (
    `<p class="mt-16 border-t border-line-strong pt-5 text-[11px] leading-relaxed text-muted">` +
    kids("出典：", sourceAnchor(), "（", licenseAnchor(), "）", acquiredOn ? `／取得日 ${acquiredOn}` : "／取得日 記載なし") +
    `<br/>当サイトは公表データをそのまま掲載しています。記載のない項目は「記載なし」と表示し、推測値による補完は行っていません。</p>`
  );
}

function facilityTable(rows: Facility[], opt: { hideCity?: boolean; hideCorp?: boolean; showMap?: boolean }): string {
  if (rows.length === 0) {
    return `<p class="card px-4 py-10 text-center text-sm text-muted">該当する施設はありません。</p>`;
  }
  const cap = (f: Facility) => (f.capacity == null ? noData : `${f.capacity}人`);
  let s =
    `<div class="card hidden md:block"><table class="dtable w-full border-collapse text-sm"><thead>` +
    `<tr class="border-b border-line-strong text-left text-xs text-muted">` +
    (opt.showMap ? `<th scope="col" class="w-32 py-2 pr-3 font-medium">地図</th>` : "") +
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
      (opt.showMap ? `<td class="py-2 pr-3">${thumbMap(f.lat, f.lng, f.name)}</td>` : "") +
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
  s += `</tbody></table></div><ul class="space-y-3 md:hidden">`;
  for (const f of rows) {
    s +=
      `<li class="card p-4"><div class="flex items-start gap-3"><div class="min-w-0 flex-1">` +
      link(`/facility/${seg(f.id)}/`, "font-medium text-ink underline-offset-2 hover:underline", kids(f.name)).s +
      `<dl class="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">` +
      `<dt class="text-muted">種別</dt><dd>${kids(f.service_type)}</dd>` +
      `<dt class="text-muted">市区町村</dt><dd>${kids([f.prefecture, f.city].filter(Boolean).join(" ") || NO_DATA)}</dd>` +
      `<dt class="text-muted">定員</dt><dd class="tabular-nums">${kids(cap(f))}</dd>` +
      `<dt class="text-muted">法人</dt><dd>${kids(f.corporation_name || noData)}</dd>` +
      `</dl></div>${opt.showMap ? thumbMap(f.lat, f.lng, f.name) : ""}</div></li>`;
  }
  s += `</ul>` + (opt.showMap ? GSI_CREDIT_HTML : "");
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
    `<div class="grid grid-cols-1 gap-1 border-b border-line px-4 py-3.5 last:border-0 sm:grid-cols-[10rem_1fr] sm:gap-4 sm:px-6">` +
    `<dt class="text-xs tracking-wider text-muted sm:pt-0.5">${esc(label)}</dt><dd class="text-sm break-words">${children}</dd></div>`
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
    `<p class="eyebrow">${kids(f.service_type)}</p>` +
    `<h1 class="mt-3 mb-8">${kids(f.name)}</h1>` +
    (hasGeo && mapEnabled(f) ? `<div class="mb-8">${detailMap(f.lat, f.lng, f.name, f.address)}${GSI_CREDIT_HTML}</div>` : "") +
    `<dl class="card mb-8">` +
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
      `<p class="mb-8 note px-4 py-3 text-xs text-muted">この施設は公表データに定員・公式URLの記載がないため、掲載している項目が限られています （当サイトの方針により検索エンジンには登録していません）。</p>`;
  }

  if (neighbors.length > 0) {
    main +=
      `<section class="reveal mb-6"><h2 class="mb-4">${kids("同じ", f.city ?? "市区町村", "の施設", raw(`<span class="ml-2 text-xs font-normal text-muted">${kids(neighbors.length, "件")}</span>`))}</h2>` +
      facilityTable(neighbors, { hideCity: true, showMap: mapEnabled(f) }) +
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
    `<div><dt>${esc(label)}</dt><dd class="tabular-nums">${kids(value)}</dd></div>`;

  let main =
    jsonLdScript(jsonLd) +
    breadcrumb([{ name: "ホーム", href: "/" }, { name: c.name }]) +
    `<h1 class="mb-6">${kids(c.name, "が運営する介護事業所")}</h1>` +
    `<dl class="stat-row mb-6">` +
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

// ---------------------------------------------------------------------------
// 種別×市区町村ページ（/type/{種別}/{都道府県}/{市区町村}/・2026-11-01 okina 承認）
// ---------------------------------------------------------------------------
// Next のページは持たない（このページは最初から直接描画だけ。CPU 上限対策・設計は README「種別×市区町村ページ」）。
// D1 読み取り：施設の取得1回（idx_facility_type_city で該当行のみ・実測 約2×件数+1行。最大130件で261行）。
// 出典情報（meta）・組み合わせ一覧（agg 'typeCityCombos'）・都道府県内訳（agg 'typePref:<種別>'）は
// lib/db.ts と同じキーの cachedAgg（isolate 内メモ＋Cache API・6時間）で、外れても1行ずつ。
// 描画済み HTML は worker.ts が Cache API に保存する（同じ URL の2回目以降は D1 を読まない）。
// index 対象施設が3件未満・存在しない組み合わせは null（Next の 404）。

async function readAggValue<T>(db: D1Database, key: string): Promise<T | undefined> {
  try {
    const r = await db.prepare("SELECT value FROM agg WHERE key = ?").bind(key).first<{ value: string | null }>();
    return r?.value == null ? undefined : (JSON.parse(r.value) as T);
  } catch {
    return undefined;
  }
}

function getTypeCityCombos(db: D1Database): Promise<TypeCityCombo[]> {
  return cachedAgg(
    "typeCityCombos",
    async () => {
      const pre = await readAggValue<TypeCityCombo[]>(db, "typeCityCombos");
      if (pre && pre.length > 0) return pre;
      // agg が無いときだけ（scripts/agg.sql と同じ条件・並び順）
      const rows = await all<{ t: string; p: string; c: string; n: number }>(
        db,
        `SELECT service_type_slug AS t, pref_slug AS p, city_slug AS c, COUNT(*) AS n FROM facility
         WHERE pref_slug <> '' AND city_slug <> ''
         GROUP BY service_type_slug, pref_slug, city_slug
         HAVING SUM(is_indexable) >= ${TYPE_CITY_MIN_INDEXABLE}
         ORDER BY service_type_slug, pref_slug, city_slug`,
        [],
      );
      return rows.map((r) => [r.t, r.p, r.c, Number(r.n)] as TypeCityCombo);
    },
    (v) => v.length === 0,
  );
}

function getTypePref(db: D1Database, type: string): Promise<Array<{ pref_slug: string; prefecture: string; n: number }>> {
  return cachedAgg(
    `typePref:${type}`,
    async () => {
      const pre = await readAggValue<Array<{ pref_slug: string; prefecture: string; n: number }>>(db, `typePref:${type}`);
      if (pre && pre.length > 0) return pre;
      return all<{ pref_slug: string; prefecture: string; n: number }>(
        db,
        `SELECT pref_slug, prefecture, COUNT(*) AS n FROM facility
         WHERE service_type_slug = ? AND pref_slug <> '' GROUP BY pref_slug, prefecture ORDER BY n DESC`,
        [type],
      );
    },
    (v) => v.length === 0,
  );
}

function fmtNum(n: number): string {
  return n.toLocaleString("ja-JP");
}

/** 中央値（偶数個は中央2つの平均。小数は1桁まで） */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(v * 10) / 10;
}

function typeCityTable(rows: Facility[], showMap: boolean): string {
  const cap = (f: Facility) => (f.capacity == null ? noData.s : `<span class="tabular-nums">${kids(f.capacity, "人")}</span>`);
  const corp = (f: Facility) =>
    f.corporation_name
      ? f.corporation_slug
        ? link(`/hojin/${seg(f.corporation_slug)}/`, "hover:text-accent hover:underline", kids(f.corporation_name)).s
        : kids(f.corporation_name)
      : noData.s;
  let s =
    `<div class="card hidden md:block"><table class="dtable w-full border-collapse text-sm"><thead>` +
    `<tr class="border-b border-line-strong text-left text-xs text-muted">` +
    (showMap ? `<th scope="col" class="w-32 py-2 pr-3 font-medium">地図</th>` : "") +
    `<th scope="col" class="py-2 pr-3 font-medium">事業所名</th>` +
    `<th scope="col" class="py-2 pr-3 font-medium">所在地</th>` +
    `<th scope="col" class="w-20 py-2 pr-3 text-right font-medium">定員</th>` +
    `<th scope="col" class="w-56 py-2 font-medium">運営法人</th>` +
    `</tr></thead><tbody>`;
  for (const f of rows) {
    s +=
      `<tr class="border-b border-line align-top hover:bg-tint">` +
      (showMap ? `<td class="py-2 pr-3">${thumbMap(f.lat, f.lng, f.name)}</td>` : "") +
      `<td class="py-2 pr-3">${link(`/facility/${seg(f.id)}/`, "font-medium text-ink underline-offset-2 hover:text-accent hover:underline", kids(f.name)).s}</td>` +
      `<td class="py-2 pr-3 text-muted">${f.address ? kids(f.address) : noData.s}</td>` +
      `<td class="py-2 pr-3 text-right">${cap(f)}</td>` +
      `<td class="py-2 text-muted">${corp(f)}</td>` +
      `</tr>`;
  }
  s += `</tbody></table></div><ul class="space-y-3 md:hidden">`;
  for (const f of rows) {
    s +=
      `<li class="card p-4"><div class="flex items-start gap-3"><div class="min-w-0 flex-1">` +
      link(`/facility/${seg(f.id)}/`, "font-medium text-ink underline-offset-2 hover:underline", kids(f.name)).s +
      `<dl class="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">` +
      `<dt class="text-muted">所在地</dt><dd>${f.address ? kids(f.address) : noData.s}</dd>` +
      `<dt class="text-muted">定員</dt><dd>${cap(f)}</dd>` +
      `<dt class="text-muted">運営法人</dt><dd>${corp(f)}</dd>` +
      `</dl></div>${showMap ? thumbMap(f.lat, f.lng, f.name) : ""}</div></li>`;
  }
  s += `</ul>` + (showMap ? GSI_CREDIT_HTML : "");
  return s;
}

function chips(items: Array<{ href: string; label: string; n: number }>): string {
  return (
    `<ul class="flex flex-wrap gap-2">` +
    items
      .map((i) => `<li>${link(i.href, "chip", kids(i.label, raw(`<span class="chip-count">${esc(fmtNum(i.n))}</span>`))).s}</li>`)
      .join("") +
    `</ul>`
  );
}

export async function renderTypeCity(
  db: D1Database,
  type: string,
  pref: string,
  city: string,
  shell: DirectShell,
): Promise<string | null> {
  const label = TYPE_CITY_LABELS[type];
  const prefName = SLUG_TO_PREF[pref];
  if (!label || !prefName || !city) return null;

  // 1件の市区町村で最大130件（2026-09-29 取得分）。念のため上限を掛ける
  const rows = await all<Facility>(
    db,
    `SELECT ${FACILITY_COLS} FROM facility
     WHERE service_type_slug = ? AND pref_slug = ? AND city_slug = ?
     ORDER BY name LIMIT 500`,
    [type, pref, city],
  );
  const indexable = rows.filter((r) => Number(r.is_indexable) === 1).length;
  if (rows.length === 0 || !qualifiesTypeCity(indexable)) return null;

  const [meta, combos, typePref] = await Promise.all([getMeta(db), getTypeCityCombos(db), getTypePref(db, type)]);

  const first = rows[0];
  const cityName = first.city || city;
  const typeName = first.service_type;
  const where = `${prefName}${cityName}`;
  const n = rows.length;
  const acquired = first.acquired_on ?? meta.acquired_on ?? null;
  const path = typeCityPath(type, pref, city);

  // ---- 公表データからの集計（このページの組み合わせだけ） ----
  const caps = rows.map((r) => r.capacity).filter((c): c is number => c != null);
  const capSum = caps.reduce((a, b) => a + b, 0);
  const capMedian = median(caps);
  const withUrl = rows.filter((r) => r.official_url).length;
  const corpCounts = new Map<string, { name: string; slug: string; n: number }>();
  let noCorpNo = 0;
  for (const r of rows) {
    if (!r.corporation_slug) {
      noCorpNo += 1;
      continue;
    }
    const cur = corpCounts.get(r.corporation_slug);
    if (cur) cur.n += 1;
    else corpCounts.set(r.corporation_slug, { name: r.corporation_name ?? r.corporation_slug, slug: r.corporation_slug, n: 1 });
  }
  const corpMulti = [...corpCounts.values()].filter((c) => c.n >= 2).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ja"));
  const bands = CAPACITY_BANDS.map((b) => ({ label: b.label, n: caps.filter((c) => c >= b.min && c <= b.max).length })).filter(
    (b) => b.n > 0,
  );
  const prefTotal = typePref.find((p) => p.pref_slug === pref)?.n ?? 0;
  const share = prefTotal > 0 ? ((n / prefTotal) * 100).toFixed(1) : null;

  // ---- 関連ページ（同じ基準で作ったページだけにリンクする） ----
  const otherTypes = combos
    .filter(([t, p, c]) => p === pref && c === city && t !== type && TYPE_CITY_LABELS[t])
    .map(([t, , , cnt]) => ({ href: typeCityPath(t, pref, city), label: `${cityName}の${TYPE_CITY_LABELS[t]}`, n: cnt }));
  const samePref = combos
    .filter(([t, p, c]) => t === type && p === pref && c !== city)
    .sort((a, b) => b[3] - a[3] || a[2].localeCompare(b[2], "ja"))
    .map(([, , c, cnt]) => ({ href: typeCityPath(type, pref, c), label: c, n: cnt }));

  const metaInfo = {
    title: `${where}の${label}一覧（${n}件）`,
    description: `${where}の${typeName}${n}件の一覧です。所在地・定員・運営法人を、厚生労働省の公表データ${acquired ? `（取得日 ${acquired}）` : ""}にもとづいて掲載しています。`,
    canonical: abs(path),
    robots: { index: true, follow: true },
  };

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${where}の${label}`,
    numberOfItems: n,
    itemListElement: rows.map((f, i) => ({ "@type": "ListItem", position: i + 1, name: f.name, url: abs(`/facility/${seg(f.id)}/`) })),
  };

  const stat = (k: string, v: string) => `<div><dt>${esc(k)}</dt><dd class="tabular-nums">${kids(v)}</dd></div>`;
  const guide = TYPE_GUIDES[type];

  let main =
    jsonLdScript(itemList) +
    breadcrumb([
      { name: "ホーム", href: "/" },
      { name: "サービス種別から探す", href: "/type/" },
      { name: typeName, href: `/type/${seg(type)}/` },
      { name: prefName, href: `/area/${seg(pref)}/` },
      { name: `${cityName}の${label}` },
    ]) +
    `<p class="eyebrow">${kids(typeName)}</p>` +
    `<h1 class="mt-3 mb-6">${kids(where, "の", label)}</h1>` +
    `<p class="mb-6 max-w-3xl text-sm leading-relaxed">` +
    kids(
      `${where}の${typeName}は、${SOURCE_NAME}の公表データ${acquired ? `（取得日 ${acquired}）` : ""}で${fmtNum(n)}件です。`,
      share != null ? `${prefName}全体の${fmtNum(prefTotal)}件のうち${share}%にあたります。` : "",
      `運営法人は、法人番号で数えて${fmtNum(corpCounts.size)}法人です${noCorpNo > 0 ? `（法人番号の記載がない施設${fmtNum(noCorpNo)}件を除く）` : ""}。`,
      caps.length > 0
        ? `定員の記載がある${fmtNum(caps.length)}件の定員の合計は${fmtNum(capSum)}人です。`
        : "定員はいずれの施設にも記載がありません。",
    ) +
    `</p>` +
    `<dl class="stat-row mb-8">` +
    stat("掲載施設", fmtNum(n)) +
    stat("定員の記載あり", fmtNum(caps.length)) +
    stat("定員の合計（記載分）", caps.length > 0 ? `${fmtNum(capSum)}人` : NO_DATA) +
    stat("定員の中央値（記載分）", capMedian != null ? `${capMedian}人` : NO_DATA) +
    stat("公式URLあり", fmtNum(withUrl)) +
    `</dl>`;

  // 定員の内訳
  if (bands.length > 0) {
    main +=
      `<section class="mb-10"><h2 class="mb-4">定員の内訳</h2>` +
      `<div class="card max-w-md"><table class="dtable w-full border-collapse text-sm"><thead>` +
      `<tr class="border-b border-line-strong text-left text-xs text-muted"><th scope="col" class="py-2 pr-3 font-medium">定員</th><th scope="col" class="py-2 text-right font-medium">施設数</th></tr></thead><tbody>` +
      bands.map((b) => `<tr class="border-b border-line"><td class="py-2 pr-3">${esc(b.label)}</td><td class="py-2 text-right tabular-nums">${esc(fmtNum(b.n))}</td></tr>`).join("") +
      (n - caps.length > 0
        ? `<tr class="border-b border-line"><td class="py-2 pr-3 text-muted">${NO_DATA}</td><td class="py-2 text-right tabular-nums">${esc(fmtNum(n - caps.length))}</td></tr>`
        : "") +
      `</tbody></table></div>` +
      `<p class="mt-3 text-xs text-muted">出典データの「定員」の値をそのまま数えています。記載がないことは、定員が少ないことを意味するものではありません。</p>` +
      `</section>`;
  }

  // 施設一覧
  main +=
    `<section class="mb-10"><h2 class="mb-4">${kids("施設一覧", raw(`<span class="ml-2 text-xs font-normal text-muted">${esc(fmtNum(n))}件</span>`))}</h2>` +
    `<p class="mb-4 text-xs leading-relaxed text-muted">${kids("事業所名の順に表示しています。", raw(`<span class="ml-1 font-bold text-ink">${esc(NOT_A_RECOMMENDATION)}</span>`))}</p>` +
    typeCityTable(rows, mapEnabled({ prefecture: prefName, city: cityName })) +
    `<p class="mt-4 text-xs text-muted">${esc(`定員・公式URL・運営法人が「${NO_DATA}」の施設は、出典データに記載がないものです（当サイトで推定した値は掲載していません）。`)}</p>` +
    `</section>`;

  // 同じ法人が複数運営している場合の内訳
  if (corpMulti.length > 0) {
    main +=
      `<section class="mb-10"><h2 class="mb-4">${kids(cityName, "で2施設以上を運営する法人")}</h2>` +
      chips(corpMulti.map((c) => ({ href: `/hojin/${seg(c.slug)}/`, label: c.name, n: c.n }))) +
      `<p class="mt-3 text-xs text-muted">数字は${esc(`${cityName}の${typeName}`)}のうち、その法人が運営する施設の数です（法人番号で集計）。</p>` +
      `</section>`;
  }

  // 制度上の位置づけ
  if (guide) {
    main +=
      `<section class="mb-10"><h2 class="mb-4">${kids(guide.short, "とは")}</h2>` +
      `<dl class="card">` +
      row("概要", kids(guide.summary)) +
      row("主な対象者", kids(guide.target)) +
      row("設置・指定", kids(guide.operator)) +
      `</dl>` +
      `<p class="mt-3 text-xs leading-relaxed text-muted">${esc(TYPE_GUIDE_CAVEAT)}</p>` +
      `</section>`;
  }

  // 関連ページ
  main +=
    `<section class="mb-10"><h2 class="mb-4">関連するページ</h2>` +
    `<ul class="mb-6 space-y-2 text-sm">` +
    `<li>${link(`/area/${seg(pref)}/${seg(city)}/`, "text-accent hover:underline", kids(where, "の介護施設・事業所一覧（全種別）")).s}</li>` +
    `<li>${link(`/area/${seg(pref)}/`, "text-accent hover:underline", kids(prefName, "の市区町村一覧")).s}</li>` +
    `<li>${link(`/type/${seg(type)}/`, "text-accent hover:underline", kids("全国の", typeName)).s}</li>` +
    `</ul>` +
    (otherTypes.length > 0 ? `<h3 class="mb-3 text-sm font-bold">${kids(cityName, "のほかの種別")}</h3><div class="mb-6">${chips(otherTypes)}</div>` : "") +
    (samePref.length > 0
      ? `<h3 class="mb-3 text-sm font-bold">${kids(prefName, "のほかの市区町村の", label)}</h3>${chips(samePref)}`
      : "") +
    `</section>`;

  main +=
    `<p class="note px-4 py-3 text-xs leading-relaxed text-muted">` +
    esc(
      `このページは、${SOURCE_NAME}の公表データ${acquired ? `（取得日 ${acquired}。件数・定員はこの時点の値）` : ""}のうち、` +
        `${where}に所在する${typeName}をまとめたものです。件数は事業所番号とサービス種別の組み合わせごとに数えています。` +
        `公式URLか定員の記載がある施設が${TYPE_CITY_MIN_INDEXABLE}件以上ある市区町村についてのみ、このページを作成しています。`,
    ) +
    `</p>` +
    sourceNote(acquired);

  return page(shell, metaInfo, main);
}
