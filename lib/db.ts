// DB抽象化レイヤ
// - 本番(Cloudflare Workers): getCloudflareContext().env.DB (D1)
// - 開発(Node): better-sqlite3 で data/kaigo.sqlite を直接読む
//
// データ未投入(DBファイルが無い / テーブルが無い / 0件)でもページが落ちないこと。
// クエリは全て例外を飲み込み、空配列 or undefined を返す。

import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";
import { bboxWhere, withinRadius, type LatLng } from "./geo";
import { placeKey } from "./slug";
import { SITE_URL } from "./site";
import { CAPACITY_OK_SQL } from "./capacity";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export interface Facility {
  /** 「事業所番号-サービス種別スラッグ」の複合ID（schema.sql 参照） */
  id: string;
  /** 出典の事業所番号(10桁)。一意ではない */
  jigyosho_no: string;
  name: string;
  service_type: string;
  service_type_slug: string;
  is_residential: number;
  postal_code: string | null;
  prefecture: string | null;
  pref_slug: string | null;
  city: string | null;
  city_slug: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  tel: string | null;
  /** 法人番号(13桁)。無い場合は法人ページを作らない */
  corporate_number: string | null;
  corporation_name: string | null;
  corporation_slug: string | null;
  capacity: number | null;
  open_days: string | null;
  official_url: string | null;
  acquired_on: string | null;
  is_indexable: number;
}

export interface Corporation {
  /** 'c' + 法人番号13桁 */
  slug: string;
  corporate_number: string;
  name: string;
  facility_count: number;
  pref_count: number;
  /** 出典に現れた表記の異なり数（1より大きい＝表記ゆれを名寄せした） */
  name_variants: number;
}

export interface AreaRow {
  pref_slug: string;
  prefecture: string;
  city_slug: string;
  city: string;
  facility_count: number;
}

/** /ranking/* の絞り込み条件。値はスラッグ（呼び出し側で実在チェック済みのもの） */
export interface RankingFilter {
  prefSlug?: string;
  typeSlug?: string;
}

export interface TypeCount {
  service_type: string;
  service_type_slug: string;
  is_residential: number;
  facility_count: number;
}

/** place テーブルの1行（住所・地名 → 代表点） */
export interface PlaceRow {
  key: string;
  name: string;
  kind: string;
  pref_slug: string | null;
  city_slug: string | null;
  lat: number;
  lng: number;
  facility_count: number;
}

/** どうやって入力文字列を地点に結び付けたか（画面に根拠として出す） */
export type PlaceMatch = "exact" | "prefix" | "startsWith" | "contains" | "station";

export interface PlaceHit extends PlaceRow {
  match: PlaceMatch;
}

/** トップページに出す実測値 */
export interface SiteStats {
  facilities: number;
  corporations: number;
  cities: number;
  /** 掲載が3件以上ある市区町村 */
  cities3: number;
  prefs: number;
  withCapacity: number;
  withGeo: number;
}

// ---------------------------------------------------------------------------
// ドライバ
// ---------------------------------------------------------------------------

interface DbDriver {
  all<T>(sql: string, params: unknown[]): Promise<T[]>;
  get<T>(sql: string, params: unknown[]): Promise<T | undefined>;
}

class D1Driver implements DbDriver {
  constructor(private d1: D1Database) {}
  async all<T>(sql: string, params: unknown[]): Promise<T[]> {
    const r = await this.d1.prepare(sql).bind(...(params as never[])).all<T>();
    return (r.results ?? []) as T[];
  }
  async get<T>(sql: string, params: unknown[]): Promise<T | undefined> {
    const r = await this.d1.prepare(sql).bind(...(params as never[])).first<T>();
    return (r ?? undefined) as T | undefined;
  }
}

/** 何も入っていないDB。開発機にsqliteが無い場合のフォールバック。 */
const emptyDriver: DbDriver = {
  async all<T>(): Promise<T[]> { return [] as T[]; },
  async get<T>(): Promise<T | undefined> { return undefined; },
};

// 開発専用 (CF Workers にはバンドルされない)
function createSqliteDriver(): DbDriver {
  try {
    // dynamic require: webpack/turbopack に解決させない
    const req = eval("require") as NodeRequire;
    const Database = req("better-sqlite3");
    const path = req("path");
    const fs = req("fs");
    const dbPath = path.join(process.cwd(), "data", "kaigo.sqlite");
    if (!fs.existsSync(dbPath)) {
      // CSV未着の初期状態。0件として扱う。
      return emptyDriver;
    }
    const db = new Database(dbPath, { readonly: true });
    return {
      async all<T>(sql: string, params: unknown[]): Promise<T[]> {
        return db.prepare(sql).all(...params) as T[];
      },
      async get<T>(sql: string, params: unknown[]): Promise<T | undefined> {
        return db.prepare(sql).get(...params) as T | undefined;
      },
    };
  } catch {
    return emptyDriver;
  }
}

function getDriver(): { driver: DbDriver; isD1: boolean } {
  try {
    const ctx = getCloudflareContext() as unknown as { env?: Record<string, unknown> };
    const d1 = ctx?.env?.DB as D1Database | undefined;
    if (d1) return { driver: new D1Driver(d1), isD1: true };
  } catch {
    // 開発環境では getCloudflareContext() が無効 → sqlite にフォールバック
  }
  return { driver: createSqliteDriver(), isD1: false };
}

/**
 * D1 の取得失敗。
 *
 * 以前は D1 の失敗も「0件」として飲み込んでいたため、無料枠の行読み取り上限
 * (5M rows/日) を超えた日に /area/ 等が「データ準備中」を 200 で返し、
 * /facility/・/hojin/ は 404 を返していた（2026-09-30 okina 報告、2026-10-14 再現）。
 * 404 は検索エンジンに「ページが消えた」と伝えてしまうので、本番(D1)の失敗は
 * 例外として投げ、5xx（一時的な障害）として返す。
 * 開発機の sqlite 未投入・テーブル未作成は従来どおり 0件扱い（EmptyState）。
 */
export class DbUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`D1 query failed: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "DbUnavailableError";
  }
}

async function safeAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { driver, isD1 } = getDriver();
  try {
    return await driver.all<T>(sql, params);
  } catch (e) {
    if (isD1) {
      console.error("[db] D1 query failed:", (e as Error).message);
      throw new DbUnavailableError(e);
    }
    if (process.env.NODE_ENV !== "production") console.warn("[db] query failed:", (e as Error).message);
    return [];
  }
}

async function safeGet<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const { driver, isD1 } = getDriver();
  try {
    return await driver.get<T>(sql, params);
  } catch (e) {
    if (isD1) {
      console.error("[db] D1 query failed:", (e as Error).message);
      throw new DbUnavailableError(e);
    }
    if (process.env.NODE_ENV !== "production") console.warn("[db] query failed:", (e as Error).message);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 全体集計のキャッシュ
// ---------------------------------------------------------------------------
//
// facility 全件を数える集計（siteStats / typeCounts など）は1回で 1.7万〜3.2万行を読む。
// これがトップや一覧のリクエストごとに走り、D1 無料枠(5M rows/日)を毎日使い切っていた
// （2026-10-12〜13 の実測: siteStats 924回で 29.7M行、typeCounts 984回で 16.5M行）。
// 引数を取らない全体集計だけを、isolate 内メモ＋Workers の Cache API で数時間キャッシュする。
// データは `scripts/deploy.sh load` のときしか変わらないので、値の鮮度の問題は小さい
// （データ更新直後に即反映したいときは Cloudflare のキャッシュを全削除する）。
// 空の結果・失敗はキャッシュしない。

const AGG_TTL_SEC = 6 * 60 * 60;
const memo = new Map<string, { at: number; value: unknown }>();
// 市区町村ごとの施設一覧（sameCity:*）も載るので、isolate のメモリを食い過ぎないよう件数に上限を掛ける。
// Map は挿入順なので、溢れたら古いものから捨てる（Cache API 側には残る）。
const MEMO_MAX = 400;
function memoSet(key: string, entry: { at: number; value: unknown }): void {
  memo.delete(key);
  memo.set(key, entry);
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
}

function isEmptyResult(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// 6時間を過ぎた値も、D1 が読めないとき（無料枠の読み取り上限超過など）の代わりとして残しておく期間。
// 2026-10-19 19時台(JST)に D1 が上限に達し、翌09:00 のリセットまで、キャッシュの切れた
// /sitemap.xml が 5xx を返していた（07:00 の機械点検で「取得できない」）。値は load 時にしか変わらないので、
// 古い値を返しても実害は小さい。
const AGG_STALE_SEC = 7 * 24 * 60 * 60;
const AGG_AT_HEADER = "x-agg-at";

async function cachedAgg<T>(key: string, fn: () => Promise<T>, isEmpty: (v: T) => boolean = isEmptyResult): Promise<T> {
  const now = Date.now();
  const m = memo.get(key);
  if (m && now - m.at < AGG_TTL_SEC * 1000) return m.value as T;
  let stale: { value: T } | undefined = m ? { value: m.value as T } : undefined;

  // Cache API は Workers 上でのみ使う（開発機の Node では素通り）
  const cacheStore = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const { isD1 } = getDriver();
  const req = isD1 && cacheStore ? new Request(`${SITE_URL}/__agg/${encodeURIComponent(key)}`) : null;
  if (req && cacheStore) {
    try {
      const hit = await cacheStore.match(req);
      if (hit) {
        // 書いた時刻が無い＝旧形式（max-age 6時間で書いたもの）なので新しいものとして扱う
        const at = Number(hit.headers.get(AGG_AT_HEADER)) || now;
        const value = (await hit.json()) as T;
        if (now - at < AGG_TTL_SEC * 1000) {
          memoSet(key, { at, value });
          return value;
        }
        stale = { value };
      }
    } catch {
      // キャッシュの不調は無視してDBを読む
    }
  }

  let value: T;
  try {
    value = await fn();
  } catch (e) {
    if (stale) {
      console.warn(`[db] agg '${key}' を更新できないため古い値を返します:`, (e as Error).message);
      return stale.value;
    }
    throw e;
  }
  if (isEmpty(value) && stale) return stale.value;
  if (!isEmpty(value)) {
    memoSet(key, { at: now, value });
    if (req && cacheStore) {
      try {
        await cacheStore.put(
          req,
          new Response(JSON.stringify(value), {
            headers: {
              "content-type": "application/json",
              "cache-control": `public, max-age=${AGG_STALE_SEC}`,
              [AGG_AT_HEADER]: String(now),
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

/**
 * agg テーブル（scripts/agg.sql で load 時に事前計算した全体集計）から1行読む。
 * 1回あたりの D1 読み取りは1行。テーブルや key が無い・壊れているときは undefined を返し、
 * 呼び出し側は従来どおり facility を数える（*Live）。
 */
async function readAgg<T>(key: string): Promise<T | undefined> {
  const { driver } = getDriver();
  try {
    const r = await driver.get<{ value: string | null }>("SELECT value FROM agg WHERE key = ?", [key]);
    if (r?.value == null) {
      console.warn(`[db] agg '${key}' がありません。scripts/deploy.sh agg を実行してください（facility を直接数えます）`);
      return undefined;
    }
    return JSON.parse(r.value) as T;
  } catch (e) {
    console.warn(`[db] agg '${key}' を読めませんでした:`, (e as Error).message);
    return undefined;
  }
}

/** 事前計算があればそれを、無ければ live を使う。どちらも cachedAgg で包む */
function aggOrLive<T>(key: string, live: () => Promise<T>, isEmpty: (v: T) => boolean = isEmptyResult): Promise<T> {
  return cachedAgg(key, async () => {
    const pre = await readAgg<T>(key);
    if (pre !== undefined && !isEmpty(pre)) return pre;
    return live();
  }, isEmpty);
}

// ---------------------------------------------------------------------------
// クエリ
// ---------------------------------------------------------------------------

// capacity は範囲外（日付の混入など。lib/capacity.ts）を NULL にして返す。どのページでも誤値を表示しないため。
const FACILITY_COLS =
  "id, jigyosho_no, name, service_type, service_type_slug, is_residential, postal_code, prefecture, pref_slug, city, city_slug, address, lat, lng, tel, corporate_number, corporation_name, corporation_slug, " +
  `CASE WHEN ${CAPACITY_OK_SQL} THEN capacity END AS capacity, ` +
  "open_days, official_url, acquired_on, is_indexable";

const CORP_COLS = "slug, corporate_number, name, facility_count, pref_count, name_variants";

const PLACE_COLS = "key, name, kind, pref_slug, city_slug, lat, lng, facility_count";

/** LIKE のワイルドカードを打ち消す（利用者の入力に % や _ が入っていても素直に扱う） */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// 地名検索（トップの /?q=）の結果キャッシュ
// ---------------------------------------------------------------------------
// 地名が見つからない入力では「入力で始まる」「入力を含む」の LIKE が place 表の全件（約6.2万行）を読む。
// 2026-10-27 16時(UTC)から、これが1日26回・約161万行（日次上限500万行の約3割）になった。
// place 表は load のときしか変わらないので、同じ入力の結果（見つからなかったことも含む）を
// isolate 内メモ＋Cache API に24時間保存し、2回目以降は D1 を読まない。表示される結果は変わらない。
const PLACE_TTL_SEC = 24 * 60 * 60;
// place.key の最長は27文字（2026-10-28 時点）。これより長い入力を「含む」「で始まる」キーは存在しないので、
// LIKE の全件読みを省いても結果は同じ（余裕を見て64文字）。
const PLACE_KEY_MAX = 64;
const placeMemo = new Map<string, { at: number; value: unknown }>();
const PLACE_MEMO_MAX = 500;
// 「%入力%」が0件だったキー（同じ要求の placeSuggestions で D1 を読まないため）
const noContainsMatch = new Set<string>();
function rememberNoContains(k: string): void {
  noContainsMatch.delete(k);
  noContainsMatch.add(k);
  while (noContainsMatch.size > PLACE_MEMO_MAX) noContainsMatch.delete(noContainsMatch.values().next().value as string);
}

async function cachedPlace<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const m = placeMemo.get(key);
  if (m && now - m.at < PLACE_TTL_SEC * 1000) return m.value as T;

  const cacheStore = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const { isD1 } = getDriver();
  const req = isD1 && cacheStore ? new Request(`${SITE_URL}/__place/${encodeURIComponent(key)}`) : null;
  if (req && cacheStore) {
    try {
      const hit = await cacheStore.match(req);
      if (hit) {
        const { v: raw } = (await hit.json()) as { v: T | null };
        const v = (raw === null ? undefined : raw) as T; // 「見つからない」は null で保存している
        placeMemo.delete(key);
        placeMemo.set(key, { at: now, value: v });
        return v;
      }
    } catch {
      // キャッシュの不調は無視して DB を読む
    }
  }

  const value = await fn(); // D1 失敗は例外のまま（保存しない）
  placeMemo.delete(key);
  placeMemo.set(key, { at: now, value });
  while (placeMemo.size > PLACE_MEMO_MAX) placeMemo.delete(placeMemo.keys().next().value as string);
  if (req && cacheStore) {
    try {
      await cacheStore.put(
        req,
        new Response(JSON.stringify({ v: value ?? null }), {
          headers: { "content-type": "application/json", "cache-control": `public, max-age=${PLACE_TTL_SEC}` },
        }),
      );
    } catch {
      // 書けなくても表示は続ける
    }
  }
  return value;
}

/** resolvePlace の本体（キャッシュなし）。手順はそのまま */
async function resolvePlaceUncached(k: string): Promise<PlaceHit | undefined> {
  // 1) 入力の先頭に一致する最長キー
  const prefixes: string[] = [];
  for (let len = Math.min(k.length, 40); len >= 2; len--) prefixes.push(k.slice(0, len));
  const byPrefix = await safeGet<PlaceRow>(
    `SELECT ${PLACE_COLS} FROM place WHERE key IN (${prefixes.map(() => "?").join(",")})
     ORDER BY LENGTH(key) DESC, facility_count DESC LIMIT 1`,
    prefixes,
  );
  if (byPrefix) return { ...byPrefix, match: byPrefix.key === k ? "exact" : "prefix" };

  if (k.length <= PLACE_KEY_MAX) {
    // 2) 入力で始まるキー
    const esc = likeEscape(k);
    const startsWith = await safeGet<PlaceRow>(
      `SELECT ${PLACE_COLS} FROM place WHERE key LIKE ? ESCAPE '\\'
       ORDER BY facility_count DESC, LENGTH(key) ASC LIMIT 1`,
      [`${esc}%`],
    );
    if (startsWith) return { ...startsWith, match: "startsWith" };

    // 3) 入力を含むキー
    const contains = await safeGet<PlaceRow>(
      `SELECT ${PLACE_COLS} FROM place WHERE key LIKE ? ESCAPE '\\'
       ORDER BY facility_count DESC, LENGTH(key) ASC LIMIT 1`,
      [`%${esc}%`],
    );
    if (contains) return { ...contains, match: "contains" };
  }
  // 4) 「〇〇駅」→「〇〇」で引き直す
  const withoutStation = k.replace(/駅(前|北口|南口|東口|西口)?$/, "");
  if (withoutStation !== k && withoutStation.length >= 2) {
    const again = await queries.resolvePlace(withoutStation);
    if (again) return { ...again, match: "station" };
  }
  return undefined;
}

/**
 * /ranking/* の絞り込みを WHERE 句の続き（" AND ..."）に変換する。
 * 値は必ずプレースホルダで渡す（SQLに文字列を埋め込まない）。
 */
function rankFilter(f: RankingFilter): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (f.prefSlug) { parts.push("pref_slug = ?"); params.push(f.prefSlug); }
  if (f.typeSlug) { parts.push("service_type_slug = ?"); params.push(f.typeSlug); }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}

/**
 * 市区町村ページの並べ替え。
 * ORDER BY にユーザー入力を入れないよう、許可した並びだけを固定の文字列で持つ。
 */
export const CITY_SORTS = {
  default: "is_residential DESC, service_type ASC, name ASC",
  capacity: `CASE WHEN ${CAPACITY_OK_SQL} THEN 0 ELSE 1 END ASC, CASE WHEN ${CAPACITY_OK_SQL} THEN capacity END DESC, name ASC`,
  name: "name ASC",
} as const;

export type CitySort = keyof typeof CITY_SORTS;

export function toCitySort(v: string | undefined): CitySort {
  return v === "capacity" || v === "name" ? v : "default";
}

export const queries = {
  // ---- meta ----
  // 出典・取得日などで、load のときしか変わらない。ほぼ全ページが読むので cachedAgg で包む（10/19 で1.8万回）。
  async meta(): Promise<Record<string, string>> {
    return cachedAgg("meta", async () => {
      const rows = await safeAll<{ key: string; value: string | null }>("SELECT key, value FROM meta", []);
      const out: Record<string, string> = {};
      for (const r of rows) if (r.value != null) out[r.key] = r.value;
      return out;
    }, (v) => Object.keys(v).length === 0);
  },

  async totalCount(): Promise<number> {
    // siteStats.facilities と同じ値（SELECT COUNT(*) FROM facility）
    return (await queries.siteStats()).facilities;
  },

  // ---- 施設 ----
  // generateMetadata とページ本体の両方が呼ぶので、React の cache() で1リクエスト1回にまとめる。
  facilityById: cache(async (id: string): Promise<Facility | undefined> => {
    return safeGet<Facility>(`SELECT ${FACILITY_COLS} FROM facility WHERE id = ?`, [id]);
  }),

  /** 同一市区町村の近隣施設（施設ページの内部リンク用） */
  // 施設ページごとに市区町村の全施設を並べ替えて読んでいた（1回平均95行・10/19 で約54万行）。
  // 市区町村ごとの先頭 limit+1 件を cachedAgg でキャッシュし、自施設は JS 側で除く。
  // 先頭 limit+1 件から自施設を除いて limit 件取れば、SQL で id <> ? を付けた結果と同じになる。
  async facilitiesInSameCity(prefSlug: string, citySlug: string, excludeId: string, limit = 20): Promise<Facility[]> {
    const rows = await cachedAgg(`sameCity:${prefSlug}/${citySlug}/${limit + 1}`, () =>
      safeAll<Facility>(
        `SELECT ${FACILITY_COLS} FROM facility
         WHERE pref_slug = ? AND city_slug = ?
         ORDER BY is_indexable DESC, name LIMIT ?`,
        [prefSlug, citySlug, limit + 1],
      ),
    );
    return rows.filter((r) => r.id !== excludeId).slice(0, limit);
  },

  // ---- エリア ----
  async prefectures(): Promise<Array<{ pref_slug: string; prefecture: string; facility_count: number; city_count: number }>> {
    return aggOrLive("prefectures", () => safeAll(
      `SELECT pref_slug, prefecture, SUM(facility_count) AS facility_count, COUNT(*) AS city_count
       FROM area WHERE pref_slug <> '' GROUP BY pref_slug, prefecture
       ORDER BY facility_count DESC`,
    ));
  },

  // 都道府県ページ・施設ページなどで毎回読んでいた（2026-10-21 は1,549回・約16万行）。
  // area は load 時にしか変わらないので cachedAgg で包む（0件はキャッシュしない）。
  async citiesByPref(prefSlug: string): Promise<AreaRow[]> {
    return cachedAgg(`citiesByPref:${prefSlug}`, () =>
      safeAll<AreaRow>(
        "SELECT pref_slug, prefecture, city_slug, city, facility_count FROM area WHERE pref_slug = ? ORDER BY facility_count DESC, city",
        [prefSlug],
      ),
    );
  },

  // generateMetadata とページ本体の重複を1回にまとめる（facilityById と同じ）。
  area: cache(async (prefSlug: string, citySlug: string): Promise<AreaRow | undefined> => {
    return safeGet<AreaRow>(
      "SELECT pref_slug, prefecture, city_slug, city, facility_count FROM area WHERE pref_slug = ? AND city_slug = ?",
      [prefSlug, citySlug],
    );
  }),

  async facilitiesByCity(
    prefSlug: string,
    citySlug: string,
    limit = 200,
    offset = 0,
    sort: CitySort = "default",
  ): Promise<Facility[]> {
    return safeAll<Facility>(
      `SELECT ${FACILITY_COLS} FROM facility
       WHERE pref_slug = ? AND city_slug = ?
       ORDER BY ${CITY_SORTS[sort] ?? CITY_SORTS.default}
       LIMIT ? OFFSET ?`,
      [prefSlug, citySlug, limit, offset],
    );
  },

  /** 全国の掲載件数が多い市区町村 */
  async topAreas(limit = 24): Promise<AreaRow[]> {
    return safeAll<AreaRow>(
      "SELECT pref_slug, prefecture, city_slug, city, facility_count FROM area ORDER BY facility_count DESC LIMIT ?",
      [limit],
    );
  },

  // ---- 種別 ----
  async typeCounts(): Promise<TypeCount[]> {
    return aggOrLive("typeCounts", () => safeAll<TypeCount>(
      `SELECT service_type, service_type_slug, MAX(is_residential) AS is_residential, COUNT(*) AS facility_count
       FROM facility GROUP BY service_type_slug, service_type
       ORDER BY is_residential DESC, facility_count DESC`,
    ));
  },

  /** typeCounts の1行と同じ（同じ GROUP BY を1種別に絞っただけ） */
  async typeBySlug(slug: string): Promise<TypeCount | undefined> {
    return (await queries.typeCounts()).find((t) => t.service_type_slug === slug);
  },

  // 種別の全施設（最大約4.7万行）を並べ替えて先頭100件を返すため、1回で平均2.2万行を読む
  // （2026-10-20 は32回で約72万行）。値は load 時にしか変わらないので cachedAgg で包む。
  // 存在しない種別は数えるまでもなく0件（任意の文字列でキャッシュを増やさない）。
  async facilitiesByType(slug: string, limit = 100, offset = 0): Promise<Facility[]> {
    if (!(await queries.typeBySlug(slug))) return [];
    return cachedAgg(`typeList:${slug}/${limit}/${offset}`, () =>
      safeAll<Facility>(
        `SELECT ${FACILITY_COLS} FROM facility WHERE service_type_slug = ?
         ORDER BY is_indexable DESC, prefecture, city, name LIMIT ? OFFSET ?`,
        [slug, limit, offset],
      ),
    );
  },

  /** 種別ページの都道府県別内訳 */
  async typePrefBreakdown(slug: string): Promise<Array<{ pref_slug: string; prefecture: string; n: number }>> {
    // 存在しない種別は数えるまでもなく0件（任意の文字列でキャッシュを増やさない）
    if (!(await queries.typeBySlug(slug))) return [];
    return aggOrLive(`typePref:${slug}`, () => queries.typePrefBreakdownLive(slug));
  },

  async typePrefBreakdownLive(slug: string): Promise<Array<{ pref_slug: string; prefecture: string; n: number }>> {
    return safeAll(
      `SELECT pref_slug, prefecture, COUNT(*) AS n FROM facility
       WHERE service_type_slug = ? AND pref_slug <> '' GROUP BY pref_slug, prefecture ORDER BY n DESC`,
      [slug],
    );
  },

  // ---- 法人 ----
  // facilityById と同じく、generateMetadata とページ本体の重複を1回にまとめる。
  corporationBySlug: cache(async (slug: string): Promise<Corporation | undefined> => {
    return safeGet<Corporation>(`SELECT ${CORP_COLS} FROM corporation WHERE slug = ?`, [slug]);
  }),

  async facilitiesByCorp(slug: string, limit = 300): Promise<Facility[]> {
    return safeAll<Facility>(
      `SELECT ${FACILITY_COLS} FROM facility WHERE corporation_slug = ?
       ORDER BY prefecture, city, name LIMIT ?`,
      [slug, limit],
    );
  },

  // 2026-10-21 は2,222回・約4.7万行。corporation は load 時にしか変わらないので cachedAgg で包む。
  async topCorporations(limit = 20): Promise<Corporation[]> {
    return cachedAgg(`topCorporations:${limit}`, () =>
      safeAll<Corporation>(
        `SELECT ${CORP_COLS} FROM corporation ORDER BY facility_count DESC, name LIMIT ?`,
        [limit],
      ),
    );
  },

  // ---- 並べ替え一覧（/ranking/*） ----
  //
  // 「合成した総合スコア」は作らない。出典データの値そのもの1本で並べる。
  // 同値のときの二次キーは名称など安定するものにして、リロードで順番が入れ替わらないようにする。

  /**
   * 定員が多い順。
   * 定員が NULL / 0 以下の行は対象から外す（順位に含めない）。
   * 「定員が少ない」のではなく「記載が無い」だけなので、下位に並べることもしない。
   */
  // 絞り込みなしだと1回で約4.7万行を読む（2026-10-20 23時台 UTC に2回で約9.5万行）。
  // 絞り込みは呼び出し側（parseRankingParams）で既知の都道府県・種別に限っているので、条件ごとに cachedAgg で包む。
  async facilitiesByCapacity(f: RankingFilter = {}, limit = 100, offset = 0): Promise<Facility[]> {
    const w = rankFilter(f);
    return cachedAgg(`rankCapacity:${f.prefSlug ?? ""}/${f.typeSlug ?? ""}/${limit}/${offset}`, () =>
      safeAll<Facility>(
        `SELECT ${FACILITY_COLS} FROM facility
         WHERE ${CAPACITY_OK_SQL}${w.sql}
         ORDER BY capacity DESC, name ASC, id ASC
         LIMIT ? OFFSET ?`,
        [...w.params, limit, offset],
      ),
    );
  },

  /** 定員の記載率（絞り込み条件の中での実測値） */
  async capacityStats(f: RankingFilter = {}): Promise<{ total: number; with_capacity: number }> {
    // 絞り込みなしだと facility 全件（約3.1万行）を数える。条件ごとに cachedAgg で包む（0件はキャッシュしない）
    const w = rankFilter(f);
    return cachedAgg(`capacityStats:${f.prefSlug ?? ""}/${f.typeSlug ?? ""}`, async () => {
      const r = await safeGet<{ total: number; with_capacity: number }>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ${CAPACITY_OK_SQL} THEN 1 ELSE 0 END) AS with_capacity
         FROM facility WHERE 1 = 1${w.sql}`,
        w.params,
      );
      return { total: Number(r?.total ?? 0), with_capacity: Number(r?.with_capacity ?? 0) };
    }, (v) => !(v.total > 0));
  },

  /**
   * 同一法人が運営する施設数が多い順。
   * 絞り込みが無いときは import 時に集計済みの corporation テーブルをそのまま読む。
   * 絞り込みがあるときは「その条件の中での施設数」に意味が変わるため facility から集計し直す。
   */
  async corporationsByScale(f: RankingFilter = {}, limit = 100, offset = 0): Promise<Corporation[]> {
    if (!f.prefSlug && !f.typeSlug) {
      return safeAll<Corporation>(
        `SELECT ${CORP_COLS} FROM corporation
         WHERE facility_count > 0
         ORDER BY facility_count DESC, pref_count DESC, name ASC
         LIMIT ? OFFSET ?`,
        [limit, offset],
      );
    }
    const w = rankFilter(f);
    return safeAll<Corporation>(
      `SELECT corporation_slug AS slug, corporate_number, corporation_name AS name,
              COUNT(*) AS facility_count, COUNT(DISTINCT pref_slug) AS pref_count, 1 AS name_variants
       FROM facility
       WHERE corporation_slug IS NOT NULL AND corporation_slug <> ''${w.sql}
       GROUP BY corporation_slug, corporate_number, corporation_name
       ORDER BY facility_count DESC, pref_count DESC, name ASC
       LIMIT ? OFFSET ?`,
      [...w.params, limit, offset],
    );
  },

  /** 上の並びの総行数（「全N件のうち先頭M件」表示用） */
  async corporationScaleCount(f: RankingFilter = {}): Promise<number> {
    if (!f.prefSlug && !f.typeSlug) {
      // 1回で corporation 全件（約1.4万行）を数える。0件はキャッシュしない
      return cachedAgg("corporationScaleCount", async () => {
        const r = await safeGet<{ n: number }>("SELECT COUNT(*) AS n FROM corporation WHERE facility_count > 0", []);
        return Number(r?.n ?? 0);
      }, (n) => !n);
    }
    const w = rankFilter(f);
    const r = await safeGet<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT corporation_slug FROM facility
         WHERE corporation_slug IS NOT NULL AND corporation_slug <> ''${w.sql}
         GROUP BY corporation_slug, corporation_name)`,
      w.params,
    );
    return Number(r?.n ?? 0);
  },

  /**
   * 市区町村あたりの施設数が多い順。
   * 種別の絞り込みが無いときは area テーブル（import 時に集計済み）を読む。
   * 種別で絞るときは facility から集計し直す（area は種別を持たないため）。
   */
  async areasByDensity(f: RankingFilter = {}, limit = 100, offset = 0): Promise<AreaRow[]> {
    if (!f.typeSlug) {
      const prefClause = f.prefSlug ? " AND pref_slug = ?" : "";
      const prefParams = f.prefSlug ? [f.prefSlug] : [];
      return safeAll<AreaRow>(
        `SELECT pref_slug, prefecture, city_slug, city, facility_count FROM area
         WHERE facility_count > 0${prefClause}
         ORDER BY facility_count DESC, prefecture ASC, city ASC
         LIMIT ? OFFSET ?`,
        [...prefParams, limit, offset],
      );
    }
    const w = rankFilter(f);
    return safeAll<AreaRow>(
      `SELECT pref_slug, prefecture, city_slug, city, COUNT(*) AS facility_count
       FROM facility
       WHERE city_slug IS NOT NULL AND city_slug <> ''${w.sql}
       GROUP BY pref_slug, prefecture, city_slug, city
       ORDER BY facility_count DESC, prefecture ASC, city ASC
       LIMIT ? OFFSET ?`,
      [...w.params, limit, offset],
    );
  },

  async areaDensityCount(f: RankingFilter = {}): Promise<number> {
    if (!f.typeSlug) {
      const prefClause = f.prefSlug ? " AND pref_slug = ?" : "";
      const prefParams = f.prefSlug ? [f.prefSlug] : [];
      const r = await safeGet<{ n: number }>(
        `SELECT COUNT(*) AS n FROM area WHERE facility_count > 0${prefClause}`,
        prefParams,
      );
      return Number(r?.n ?? 0);
    }
    const w = rankFilter(f);
    const r = await safeGet<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT city_slug FROM facility
         WHERE city_slug IS NOT NULL AND city_slug <> ''${w.sql}
         GROUP BY pref_slug, city_slug)`,
      w.params,
    );
    return Number(r?.n ?? 0);
  },

  // ---- 近傍検索 ----
  /**
   * 現在地から radiusKm 以内の施設。
   * D1 では三角関数が使えないため、SQLは矩形(BETWEEN)で粗く絞るだけにして、
   * 正確な距離判定と並べ替えは lib/geo.ts の Haversine で行う。
   */
  async nearby(
    center: LatLng,
    radiusKm: number,
    opts: { typeSlug?: string; limit?: number } = {},
  ): Promise<Array<Facility & { distance_km: number }>> {
    const { clause, params } = bboxWhere(center, radiusKm);
    const typeClause = opts.typeSlug ? " AND service_type_slug = ?" : "";
    const typeParams = opts.typeSlug ? [opts.typeSlug] : [];
    // 矩形内の件数が多すぎるケース(都心部)に備えて上限を掛ける。
    const scanLimit = Math.max(500, (opts.limit ?? 50) * 20);
    const rows = await safeAll<Facility>(
      `SELECT ${FACILITY_COLS} FROM facility WHERE ${clause}${typeClause} LIMIT ?`,
      [...params, ...typeParams, scanLimit],
    );
    return withinRadius(rows, center, radiusKm).slice(0, opts.limit ?? 50);
  },

  // ---- 住所・地名検索（place テーブル） ----
  //
  // 外部のジオコーディングAPIは使わない。import 時に掲載施設の緯度経度から作った
  // 「地名 → 代表点」の辞書(place)を引く。したがって出せるのは掲載データに出てくる
  // 地名だけで、それ以外は「見つかりません」と正直に返す（座標をでっち上げない）。

  /**
   * 入力文字列から地点を1つ決める。
   *   1) 入力の先頭に一致する最も長いキー（「東京都世田谷区成城6-5-34」→「東京都世田谷区成城」）
   *   2) 入力で始まるキーのうち掲載件数が最も多いもの（「世田谷区成」→「世田谷区成城」）
   *   3) 入力を含むキーのうち掲載件数が最も多いもの
   *   4) 末尾が「駅」なら外して1〜3を再試行（駅の座標そのものは持っていないので、
   *      同名の地名の代表点を返し、そのことを画面に明示する）
   */
  async resolvePlace(input: string): Promise<PlaceHit | undefined> {
    const k = placeKey(input);
    if (k.length < 2) return undefined;
    const hit = await cachedPlace(`resolve:${k}`, () => resolvePlaceUncached(k));
    // 見つからない＝3) の「%入力%」が0件だった（入力が長すぎる場合も同じく0件）
    if (!hit) rememberNoContains(k);
    return hit;
  },

  /**
   * 解決できなかったときに出す候補（入力を含む地名）。
   * トップでは resolvePlace が undefined のときだけ呼ばれる。そのとき resolvePlace の 3) で
   * 同じ「%入力%」が0件だったことが分かっているので、D1 を読まずに空を返す（結果は同じ）。
   */
  async placeSuggestions(input: string, limit = 8): Promise<PlaceRow[]> {
    const k = placeKey(input);
    if (k.length < 2 || k.length > PLACE_KEY_MAX) return [];
    if (noContainsMatch.has(k)) return [];
    return cachedPlace(`suggest:${k}/${limit}`, () =>
      safeAll<PlaceRow>(
        `SELECT ${PLACE_COLS} FROM place WHERE key LIKE ? ESCAPE '\\'
         ORDER BY facility_count DESC, LENGTH(key) ASC LIMIT ?`,
        [`%${likeEscape(k)}%`, limit],
      ),
    );
  },

  // ---- トップページに出す実測値 ----
  /**
   * すべて取り込み済みのデータから数える（推測値・固定値は置かない）。
   * 通常は scripts/agg.sql が load 時に同じSQLで数えて agg に入れた値を読む（1行）。
   * agg が無いときだけ siteStatsUncached で直接数える。
   */
  async siteStats(): Promise<SiteStats> {
    return aggOrLive("siteStats", () => queries.siteStatsUncached(), (v) => !v || !(v.facilities > 0));
  },

  async siteStatsUncached(): Promise<SiteStats> {
    const r = await safeGet<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM facility) AS facilities,
         (SELECT COUNT(*) FROM corporation) AS corporations,
         (SELECT COUNT(*) FROM area) AS cities,
         (SELECT COUNT(*) FROM area WHERE facility_count >= 3) AS cities3,
         (SELECT COUNT(DISTINCT pref_slug) FROM area WHERE pref_slug <> '') AS prefs,
         (SELECT COUNT(*) FROM facility WHERE ${CAPACITY_OK_SQL}) AS with_capacity,
         (SELECT COUNT(*) FROM facility WHERE lat IS NOT NULL AND lng IS NOT NULL) AS with_geo`,
    );
    return {
      facilities: Number(r?.facilities ?? 0),
      corporations: Number(r?.corporations ?? 0),
      cities: Number(r?.cities ?? 0),
      cities3: Number(r?.cities3 ?? 0),
      prefs: Number(r?.prefs ?? 0),
      withCapacity: Number(r?.with_capacity ?? 0),
      withGeo: Number(r?.with_geo ?? 0),
    };
  },

  // ---- sitemap 用 ----
  // sitemap は検索エンジンが何度も取りに来るので、どれも agg（事前計算・1行）を読み、
  // さらに cachedAgg（isolate 内メモ＋Cache API・6時間）で包む。1回の取得で読む D1 行は
  // キャッシュ外れでも key ごとに1行、当たれば0行（2026-10-16）。
  /** index 対象の施設IDのみ（noindexページはsitemapに載せない） */
  async indexableFacilityIds(limit = 45000): Promise<Array<{ id: string }>> {
    // 事前計算した id 一覧（JSON配列・1行）を読む。sitemap は取得のたびに 2.8万行読んでいた
    const ids = await aggOrLive<string[]>("indexableFacilityIds", async () =>
      (await safeAll<{ id: string }>("SELECT id FROM facility WHERE is_indexable = 1 ORDER BY id")).map((r) => r.id),
    );
    return ids.slice(0, limit).map((id) => ({ id }));
  },

  /** sitemap 用の市区町村 [pref_slug, city_slug]（施設1件以上）。agg 'sitemapAreas' */
  async sitemapAreaSlugs(): Promise<Array<[string, string]>> {
    return aggOrLive<Array<[string, string]>>("sitemapAreas", async () =>
      (await safeAll<{ pref_slug: string; city_slug: string }>(
        "SELECT pref_slug, city_slug FROM area WHERE facility_count > 0 ORDER BY pref_slug, city_slug",
      )).map((r) => [r.pref_slug, r.city_slug] as [string, string]),
    );
  },

  /**
   * sitemap 用の法人 slug（事業所1件以上＝index 対象の法人すべて）。agg 'corporationSlugs'。
   * 以前は事業所2件以上・上位3,000件だけで、1件の法人（約8,500件）と2件以上の残りが漏れていた。
   */
  async allCorporationSlugs(): Promise<string[]> {
    return aggOrLive<string[]>("corporationSlugs", async () =>
      (await safeAll<{ slug: string }>(
        "SELECT slug FROM corporation WHERE facility_count > 0 ORDER BY facility_count DESC, slug",
      )).map((r) => r.slug),
    );
  },

  // ---- /data/ の充足率 ----
  async coverage(): Promise<{ total: number; fields: Array<{ key: string; label: string; filled: number }> }> {
    return cachedAgg("coverage", async () => {
      const pre = await readAgg<Record<string, number>>("coverage");
      if (pre && Number(pre.total) > 0) return coverageFromRow(pre);
      return queries.coverageUncached();
    }, (v) => v.total === 0);
  },

  async coverageUncached(): Promise<{ total: number; fields: Array<{ key: string; label: string; filled: number }> }> {
    const row = await safeGet<Record<string, number>>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN name IS NOT NULL AND name <> '' THEN 1 ELSE 0 END) AS f_name,
         SUM(CASE WHEN address IS NOT NULL AND address <> '' THEN 1 ELSE 0 END) AS f_address,
         SUM(CASE WHEN prefecture IS NOT NULL AND prefecture <> '' THEN 1 ELSE 0 END) AS f_pref,
         SUM(CASE WHEN city IS NOT NULL AND city <> '' THEN 1 ELSE 0 END) AS f_city,
         SUM(CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 1 ELSE 0 END) AS f_latlng,
         SUM(CASE WHEN tel IS NOT NULL AND tel <> '' THEN 1 ELSE 0 END) AS f_tel,
         SUM(CASE WHEN corporation_name IS NOT NULL AND corporation_name <> '' THEN 1 ELSE 0 END) AS f_corp,
         SUM(CASE WHEN corporate_number IS NOT NULL AND corporate_number <> '' THEN 1 ELSE 0 END) AS f_corpno,
         SUM(CASE WHEN ${CAPACITY_OK_SQL} THEN 1 ELSE 0 END) AS f_capacity,
         SUM(CASE WHEN open_days IS NOT NULL AND open_days <> '' THEN 1 ELSE 0 END) AS f_days,
         SUM(CASE WHEN official_url IS NOT NULL AND official_url <> '' THEN 1 ELSE 0 END) AS f_url,
         SUM(CASE WHEN is_indexable = 1 THEN 1 ELSE 0 END) AS f_indexable
       FROM facility`,
    );
    return coverageFromRow(row);
  },

  /** /data/ の種別内訳 */
  async coverageByType(): Promise<Array<{ service_type: string; service_type_slug: string; n: number; f_capacity: number; f_url: number }>> {
    return aggOrLive("coverageByType", () => safeAll(
      `SELECT service_type, service_type_slug, COUNT(*) AS n,
              SUM(CASE WHEN ${CAPACITY_OK_SQL} THEN 1 ELSE 0 END) AS f_capacity,
              SUM(CASE WHEN official_url IS NOT NULL AND official_url <> '' THEN 1 ELSE 0 END) AS f_url
       FROM facility GROUP BY service_type_slug, service_type ORDER BY n DESC`,
    ));
  },
};

function coverageFromRow(row: Record<string, number> | undefined): { total: number; fields: Array<{ key: string; label: string; filled: number }> } {
  const total = Number(row?.total ?? 0);
  const fields = [
    { key: "name", label: "事業所名", filled: Number(row?.f_name ?? 0) },
    { key: "address", label: "住所", filled: Number(row?.f_address ?? 0) },
    { key: "pref", label: "都道府県", filled: Number(row?.f_pref ?? 0) },
    { key: "city", label: "市区町村", filled: Number(row?.f_city ?? 0) },
    { key: "latlng", label: "緯度・経度", filled: Number(row?.f_latlng ?? 0) },
    { key: "tel", label: "電話番号", filled: Number(row?.f_tel ?? 0) },
    { key: "corp", label: "法人名", filled: Number(row?.f_corp ?? 0) },
    { key: "corpno", label: "法人番号（法人ページの同一法人判定に使用）", filled: Number(row?.f_corpno ?? 0) },
    { key: "capacity", label: "定員（1人以上の記載）", filled: Number(row?.f_capacity ?? 0) },
    { key: "days", label: "利用可能曜日", filled: Number(row?.f_days ?? 0) },
    { key: "url", label: "公式URL", filled: Number(row?.f_url ?? 0) },
    { key: "indexable", label: "（参考）検索エンジンへの登録対象（公式URLまたは定員の記載あり）", filled: Number(row?.f_indexable ?? 0) },
  ];
  return { total, fields };
}
