// DB抽象化レイヤ
// - 本番(Cloudflare Workers): getCloudflareContext().env.DB (D1)
// - 開発(Node): better-sqlite3 で data/kaigo.sqlite を直接読む
//
// データ未投入(DBファイルが無い / テーブルが無い / 0件)でもページが落ちないこと。
// クエリは全て例外を飲み込み、空配列 or undefined を返す。

import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { bboxWhere, withinRadius, type LatLng } from "./geo";
import { placeKey } from "./slug";

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

function getDriver(): DbDriver {
  try {
    const ctx = getCloudflareContext() as unknown as { env?: Record<string, unknown> };
    const d1 = ctx?.env?.DB as D1Database | undefined;
    if (d1) return new D1Driver(d1);
  } catch {
    // 開発環境では getCloudflareContext() が無効 → sqlite にフォールバック
  }
  return createSqliteDriver();
}

/** テーブル未作成・DB未接続でも落とさない */
async function safeAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return await getDriver().all<T>(sql, params);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.warn("[db] query failed:", (e as Error).message);
    return [];
  }
}

async function safeGet<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  try {
    return await getDriver().get<T>(sql, params);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.warn("[db] query failed:", (e as Error).message);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// クエリ
// ---------------------------------------------------------------------------

const FACILITY_COLS =
  "id, jigyosho_no, name, service_type, service_type_slug, is_residential, postal_code, prefecture, pref_slug, city, city_slug, address, lat, lng, tel, corporate_number, corporation_name, corporation_slug, capacity, open_days, official_url, acquired_on, is_indexable";

const CORP_COLS = "slug, corporate_number, name, facility_count, pref_count, name_variants";

const PLACE_COLS = "key, name, kind, pref_slug, city_slug, lat, lng, facility_count";

/** LIKE のワイルドカードを打ち消す（利用者の入力に % や _ が入っていても素直に扱う） */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
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
  capacity: "CASE WHEN capacity IS NULL OR capacity <= 0 THEN 1 ELSE 0 END ASC, capacity DESC, name ASC",
  name: "name ASC",
} as const;

export type CitySort = keyof typeof CITY_SORTS;

export function toCitySort(v: string | undefined): CitySort {
  return v === "capacity" || v === "name" ? v : "default";
}

export const queries = {
  // ---- meta ----
  async meta(): Promise<Record<string, string>> {
    const rows = await safeAll<{ key: string; value: string | null }>("SELECT key, value FROM meta", []);
    const out: Record<string, string> = {};
    for (const r of rows) if (r.value != null) out[r.key] = r.value;
    return out;
  },

  async totalCount(): Promise<number> {
    const r = await safeGet<{ n: number }>("SELECT COUNT(*) AS n FROM facility", []);
    return r?.n ?? 0;
  },

  // ---- 施設 ----
  async facilityById(id: string): Promise<Facility | undefined> {
    return safeGet<Facility>(`SELECT ${FACILITY_COLS} FROM facility WHERE id = ?`, [id]);
  },

  /** 同一市区町村の近隣施設（施設ページの内部リンク用） */
  async facilitiesInSameCity(prefSlug: string, citySlug: string, excludeId: string, limit = 20): Promise<Facility[]> {
    return safeAll<Facility>(
      `SELECT ${FACILITY_COLS} FROM facility
       WHERE pref_slug = ? AND city_slug = ? AND id <> ?
       ORDER BY is_indexable DESC, name LIMIT ?`,
      [prefSlug, citySlug, excludeId, limit],
    );
  },

  // ---- エリア ----
  async prefectures(): Promise<Array<{ pref_slug: string; prefecture: string; facility_count: number; city_count: number }>> {
    return safeAll(
      `SELECT pref_slug, prefecture, SUM(facility_count) AS facility_count, COUNT(*) AS city_count
       FROM area WHERE pref_slug <> '' GROUP BY pref_slug, prefecture
       ORDER BY facility_count DESC`,
    );
  },

  async citiesByPref(prefSlug: string): Promise<AreaRow[]> {
    return safeAll<AreaRow>(
      "SELECT pref_slug, prefecture, city_slug, city, facility_count FROM area WHERE pref_slug = ? ORDER BY facility_count DESC, city",
      [prefSlug],
    );
  },

  async area(prefSlug: string, citySlug: string): Promise<AreaRow | undefined> {
    return safeGet<AreaRow>(
      "SELECT pref_slug, prefecture, city_slug, city, facility_count FROM area WHERE pref_slug = ? AND city_slug = ?",
      [prefSlug, citySlug],
    );
  },

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
    return safeAll<TypeCount>(
      `SELECT service_type, service_type_slug, MAX(is_residential) AS is_residential, COUNT(*) AS facility_count
       FROM facility GROUP BY service_type_slug, service_type
       ORDER BY is_residential DESC, facility_count DESC`,
    );
  },

  async typeBySlug(slug: string): Promise<TypeCount | undefined> {
    return safeGet<TypeCount>(
      `SELECT service_type, service_type_slug, MAX(is_residential) AS is_residential, COUNT(*) AS facility_count
       FROM facility WHERE service_type_slug = ? GROUP BY service_type_slug, service_type`,
      [slug],
    );
  },

  async facilitiesByType(slug: string, limit = 100, offset = 0): Promise<Facility[]> {
    return safeAll<Facility>(
      `SELECT ${FACILITY_COLS} FROM facility WHERE service_type_slug = ?
       ORDER BY is_indexable DESC, prefecture, city, name LIMIT ? OFFSET ?`,
      [slug, limit, offset],
    );
  },

  /** 種別ページの都道府県別内訳 */
  async typePrefBreakdown(slug: string): Promise<Array<{ pref_slug: string; prefecture: string; n: number }>> {
    return safeAll(
      `SELECT pref_slug, prefecture, COUNT(*) AS n FROM facility
       WHERE service_type_slug = ? AND pref_slug <> '' GROUP BY pref_slug, prefecture ORDER BY n DESC`,
      [slug],
    );
  },

  // ---- 法人 ----
  async corporationBySlug(slug: string): Promise<Corporation | undefined> {
    return safeGet<Corporation>(`SELECT ${CORP_COLS} FROM corporation WHERE slug = ?`, [slug]);
  },

  async facilitiesByCorp(slug: string, limit = 300): Promise<Facility[]> {
    return safeAll<Facility>(
      `SELECT ${FACILITY_COLS} FROM facility WHERE corporation_slug = ?
       ORDER BY prefecture, city, name LIMIT ?`,
      [slug, limit],
    );
  },

  async topCorporations(limit = 20): Promise<Corporation[]> {
    return safeAll<Corporation>(
      `SELECT ${CORP_COLS} FROM corporation ORDER BY facility_count DESC, name LIMIT ?`,
      [limit],
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
  async facilitiesByCapacity(f: RankingFilter = {}, limit = 100, offset = 0): Promise<Facility[]> {
    const w = rankFilter(f);
    return safeAll<Facility>(
      `SELECT ${FACILITY_COLS} FROM facility
       WHERE capacity IS NOT NULL AND capacity > 0${w.sql}
       ORDER BY capacity DESC, name ASC, id ASC
       LIMIT ? OFFSET ?`,
      [...w.params, limit, offset],
    );
  },

  /** 定員の記載率（絞り込み条件の中での実測値） */
  async capacityStats(f: RankingFilter = {}): Promise<{ total: number; with_capacity: number }> {
    const w = rankFilter(f);
    const r = await safeGet<{ total: number; with_capacity: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN capacity IS NOT NULL AND capacity > 0 THEN 1 ELSE 0 END) AS with_capacity
       FROM facility WHERE 1 = 1${w.sql}`,
      w.params,
    );
    return { total: Number(r?.total ?? 0), with_capacity: Number(r?.with_capacity ?? 0) };
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
      const r = await safeGet<{ n: number }>("SELECT COUNT(*) AS n FROM corporation WHERE facility_count > 0", []);
      return Number(r?.n ?? 0);
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

    // 1) 入力の先頭に一致する最長キー
    const prefixes: string[] = [];
    for (let len = Math.min(k.length, 40); len >= 2; len--) prefixes.push(k.slice(0, len));
    const byPrefix = await safeGet<PlaceRow>(
      `SELECT ${PLACE_COLS} FROM place WHERE key IN (${prefixes.map(() => "?").join(",")})
       ORDER BY LENGTH(key) DESC, facility_count DESC LIMIT 1`,
      prefixes,
    );
    if (byPrefix) return { ...byPrefix, match: byPrefix.key === k ? "exact" : "prefix" };

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

    // 4) 「〇〇駅」→「〇〇」で引き直す
    const withoutStation = k.replace(/駅(前|北口|南口|東口|西口)?$/, "");
    if (withoutStation !== k && withoutStation.length >= 2) {
      const again = await queries.resolvePlace(withoutStation);
      if (again) return { ...again, match: "station" };
    }
    return undefined;
  },

  /** 解決できなかったときに出す候補（入力を含む地名） */
  async placeSuggestions(input: string, limit = 8): Promise<PlaceRow[]> {
    const k = placeKey(input);
    if (k.length < 2) return [];
    return safeAll<PlaceRow>(
      `SELECT ${PLACE_COLS} FROM place WHERE key LIKE ? ESCAPE '\\'
       ORDER BY facility_count DESC, LENGTH(key) ASC LIMIT ?`,
      [`%${likeEscape(k)}%`, limit],
    );
  },

  // ---- トップページに出す実測値 ----
  /**
   * すべて取り込み済みのデータから数える（推測値・固定値は置かない）。
   * meta にも import 時の値を入れてあるが、こちらはDBを直接数えるので常に現物と一致する。
   */
  async siteStats(): Promise<SiteStats> {
    const r = await safeGet<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM facility) AS facilities,
         (SELECT COUNT(*) FROM corporation) AS corporations,
         (SELECT COUNT(*) FROM area) AS cities,
         (SELECT COUNT(*) FROM area WHERE facility_count >= 3) AS cities3,
         (SELECT COUNT(DISTINCT pref_slug) FROM area WHERE pref_slug <> '') AS prefs,
         (SELECT COUNT(*) FROM facility WHERE capacity IS NOT NULL AND capacity > 0) AS with_capacity,
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
  /** index 対象の施設IDのみ（noindexページはsitemapに載せない） */
  async indexableFacilityIds(limit = 45000): Promise<Array<{ id: string }>> {
    return safeAll<{ id: string }>("SELECT id FROM facility WHERE is_indexable = 1 ORDER BY id LIMIT ?", [limit]);
  },

  async allAreas(): Promise<AreaRow[]> {
    return safeAll<AreaRow>(
      "SELECT pref_slug, prefecture, city_slug, city, facility_count FROM area WHERE facility_count > 0 ORDER BY pref_slug, city_slug",
    );
  },

  async allCorporationSlugs(minFacilities = 1, limit = 5000): Promise<Array<{ slug: string }>> {
    return safeAll<{ slug: string }>(
      "SELECT slug FROM corporation WHERE facility_count >= ? ORDER BY facility_count DESC LIMIT ?",
      [minFacilities, limit],
    );
  },

  // ---- /data/ の充足率 ----
  async coverage(): Promise<{ total: number; fields: Array<{ key: string; label: string; filled: number }> }> {
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
         SUM(CASE WHEN capacity IS NOT NULL THEN 1 ELSE 0 END) AS f_capacity,
         SUM(CASE WHEN open_days IS NOT NULL AND open_days <> '' THEN 1 ELSE 0 END) AS f_days,
         SUM(CASE WHEN official_url IS NOT NULL AND official_url <> '' THEN 1 ELSE 0 END) AS f_url,
         SUM(CASE WHEN is_indexable = 1 THEN 1 ELSE 0 END) AS f_indexable
       FROM facility`,
    );
    const total = Number(row?.total ?? 0);
    const fields = [
      { key: "name", label: "事業所名", filled: Number(row?.f_name ?? 0) },
      { key: "address", label: "住所", filled: Number(row?.f_address ?? 0) },
      { key: "pref", label: "都道府県", filled: Number(row?.f_pref ?? 0) },
      { key: "city", label: "市区町村", filled: Number(row?.f_city ?? 0) },
      { key: "latlng", label: "緯度・経度", filled: Number(row?.f_latlng ?? 0) },
      { key: "tel", label: "電話番号", filled: Number(row?.f_tel ?? 0) },
      { key: "corp", label: "法人名", filled: Number(row?.f_corp ?? 0) },
      { key: "corpno", label: "法人番号（法人ページの名寄せキー）", filled: Number(row?.f_corpno ?? 0) },
      { key: "capacity", label: "定員（1人以上の記載）", filled: Number(row?.f_capacity ?? 0) },
      { key: "days", label: "利用可能曜日", filled: Number(row?.f_days ?? 0) },
      { key: "url", label: "公式URL", filled: Number(row?.f_url ?? 0) },
      { key: "indexable", label: "（参考）index対象＝公式URLか定員あり", filled: Number(row?.f_indexable ?? 0) },
    ];
    return { total, fields };
  },

  /** /data/ の種別内訳 */
  async coverageByType(): Promise<Array<{ service_type: string; service_type_slug: string; n: number; f_capacity: number; f_url: number }>> {
    return safeAll(
      `SELECT service_type, service_type_slug, COUNT(*) AS n,
              SUM(CASE WHEN capacity IS NOT NULL THEN 1 ELSE 0 END) AS f_capacity,
              SUM(CASE WHEN official_url IS NOT NULL AND official_url <> '' THEN 1 ELSE 0 END) AS f_url
       FROM facility GROUP BY service_type_slug, service_type ORDER BY n DESC`,
    );
  },
};
