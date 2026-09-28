// DB抽象化レイヤ
// - 本番(Cloudflare Workers): getCloudflareContext().env.DB (D1)
// - 開発(Node): better-sqlite3 で data/kaigo.sqlite を直接読む
//
// データ未投入(DBファイルが無い / テーブルが無い / 0件)でもページが落ちないこと。
// クエリは全て例外を飲み込み、空配列 or undefined を返す。

import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { bboxWhere, withinRadius, type LatLng } from "./geo";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export interface Facility {
  id: string;
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
  corporation_name: string | null;
  corporation_slug: string | null;
  capacity: number | null;
  open_days: string | null;
  official_url: string | null;
  acquired_on: string | null;
  is_indexable: number;
}

export interface Corporation {
  slug: string;
  name: string;
  facility_count: number;
  pref_count: number;
}

export interface AreaRow {
  pref_slug: string;
  prefecture: string;
  city_slug: string;
  city: string;
  facility_count: number;
}

export interface TypeCount {
  service_type: string;
  service_type_slug: string;
  is_residential: number;
  facility_count: number;
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
  "id, name, service_type, service_type_slug, is_residential, postal_code, prefecture, pref_slug, city, city_slug, address, lat, lng, tel, corporation_name, corporation_slug, capacity, open_days, official_url, acquired_on, is_indexable";

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

  async facilitiesByCity(prefSlug: string, citySlug: string, limit = 200, offset = 0): Promise<Facility[]> {
    return safeAll<Facility>(
      `SELECT ${FACILITY_COLS} FROM facility
       WHERE pref_slug = ? AND city_slug = ?
       ORDER BY is_residential DESC, service_type, name
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
    return safeGet<Corporation>("SELECT slug, name, facility_count, pref_count FROM corporation WHERE slug = ?", [slug]);
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
      "SELECT slug, name, facility_count, pref_count FROM corporation ORDER BY facility_count DESC, name LIMIT ?",
      [limit],
    );
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
         SUM(CASE WHEN postal_code IS NOT NULL AND postal_code <> '' THEN 1 ELSE 0 END) AS f_postal,
         SUM(CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 1 ELSE 0 END) AS f_latlng,
         SUM(CASE WHEN tel IS NOT NULL AND tel <> '' THEN 1 ELSE 0 END) AS f_tel,
         SUM(CASE WHEN corporation_name IS NOT NULL AND corporation_name <> '' THEN 1 ELSE 0 END) AS f_corp,
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
      { key: "postal", label: "郵便番号", filled: Number(row?.f_postal ?? 0) },
      { key: "latlng", label: "緯度・経度", filled: Number(row?.f_latlng ?? 0) },
      { key: "tel", label: "電話番号", filled: Number(row?.f_tel ?? 0) },
      { key: "corp", label: "法人名", filled: Number(row?.f_corp ?? 0) },
      { key: "capacity", label: "定員", filled: Number(row?.f_capacity ?? 0) },
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
