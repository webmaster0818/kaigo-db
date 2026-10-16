-- 全体集計の事前計算（agg テーブル）
--
-- facility 全件を数える集計（トップの実測値・種別ごとの件数・都道府県別内訳・/data/ の充足率・
-- sitemap の施設ID一覧）は1回で数万行を読む。キャッシュ(isolate内メモ＋Cache API)はコロ／isolate
-- ごとに外れるため、外れるたびに約18万行を読み、D1 無料枠(5M rows/日)を超えていた（2026-10-15 実測）。
-- データは `scripts/deploy.sh load` のときしか変わらないので、ここで1回だけ数えて JSON で持っておき、
-- ページ側は `SELECT value FROM agg WHERE key = ?`（1行）を読むだけにする。
--
-- 各 key の中身は lib/db.ts の該当クエリ（*Live）と同じSQL・同じ並び順で作ること。
-- 定員の 1000 は lib/capacity.ts の MAX_PLAUSIBLE_CAPACITY と揃えること（範囲外は日付の混入などの誤値）。
-- 実行: scripts/deploy.sh agg（本番D1）／ scripts/import.ts が開発用 sqlite にも流す。
-- 何度流しても同じ結果になる（INSERT OR REPLACE）。

CREATE TABLE IF NOT EXISTS agg (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- siteStats（トップの実測値）
INSERT OR REPLACE INTO agg (key, value)
SELECT 'siteStats', json_object(
  'facilities',   (SELECT COUNT(*) FROM facility),
  'corporations', (SELECT COUNT(*) FROM corporation),
  'cities',       (SELECT COUNT(*) FROM area),
  'cities3',      (SELECT COUNT(*) FROM area WHERE facility_count >= 3),
  'prefs',        (SELECT COUNT(DISTINCT pref_slug) FROM area WHERE pref_slug <> ''),
  'withCapacity', (SELECT COUNT(*) FROM facility WHERE capacity IS NOT NULL AND capacity > 0 AND capacity <= 1000),
  'withGeo',      (SELECT COUNT(*) FROM facility WHERE lat IS NOT NULL AND lng IS NOT NULL)
);

-- typeCounts（種別ごとの件数。typeBySlug もここから引く）
INSERT OR REPLACE INTO agg (key, value)
SELECT 'typeCounts', COALESCE(json_group_array(json_object(
  'service_type', service_type, 'service_type_slug', service_type_slug,
  'is_residential', is_residential, 'facility_count', facility_count)), '[]')
FROM (
  SELECT service_type, service_type_slug, MAX(is_residential) AS is_residential, COUNT(*) AS facility_count
  FROM facility GROUP BY service_type_slug, service_type
  ORDER BY is_residential DESC, facility_count DESC
);

-- prefectures（/area/ とトップの都道府県一覧）
INSERT OR REPLACE INTO agg (key, value)
SELECT 'prefectures', COALESCE(json_group_array(json_object(
  'pref_slug', pref_slug, 'prefecture', prefecture, 'facility_count', facility_count, 'city_count', city_count)), '[]')
FROM (
  SELECT pref_slug, prefecture, SUM(facility_count) AS facility_count, COUNT(*) AS city_count
  FROM area WHERE pref_slug <> '' GROUP BY pref_slug, prefecture
  ORDER BY facility_count DESC
);

-- typePrefBreakdown（種別ページの都道府県別内訳）。種別ごとに1行
DELETE FROM agg WHERE key LIKE 'typePref:%';
INSERT OR REPLACE INTO agg (key, value)
SELECT 'typePref:' || service_type_slug, json_group_array(json_object(
  'pref_slug', pref_slug, 'prefecture', prefecture, 'n', n))
FROM (
  SELECT service_type_slug, pref_slug, prefecture, COUNT(*) AS n FROM facility
  WHERE pref_slug <> '' GROUP BY service_type_slug, pref_slug, prefecture
  ORDER BY service_type_slug, n DESC, pref_slug
)
GROUP BY service_type_slug;

-- coverage（/data/ の充足率）
INSERT OR REPLACE INTO agg (key, value)
SELECT 'coverage', json_object(
  'total', COUNT(*),
  'f_name', SUM(CASE WHEN name IS NOT NULL AND name <> '' THEN 1 ELSE 0 END),
  'f_address', SUM(CASE WHEN address IS NOT NULL AND address <> '' THEN 1 ELSE 0 END),
  'f_pref', SUM(CASE WHEN prefecture IS NOT NULL AND prefecture <> '' THEN 1 ELSE 0 END),
  'f_city', SUM(CASE WHEN city IS NOT NULL AND city <> '' THEN 1 ELSE 0 END),
  'f_latlng', SUM(CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 1 ELSE 0 END),
  'f_tel', SUM(CASE WHEN tel IS NOT NULL AND tel <> '' THEN 1 ELSE 0 END),
  'f_corp', SUM(CASE WHEN corporation_name IS NOT NULL AND corporation_name <> '' THEN 1 ELSE 0 END),
  'f_corpno', SUM(CASE WHEN corporate_number IS NOT NULL AND corporate_number <> '' THEN 1 ELSE 0 END),
  'f_capacity', SUM(CASE WHEN capacity IS NOT NULL AND capacity > 0 AND capacity <= 1000 THEN 1 ELSE 0 END),
  'f_days', SUM(CASE WHEN open_days IS NOT NULL AND open_days <> '' THEN 1 ELSE 0 END),
  'f_url', SUM(CASE WHEN official_url IS NOT NULL AND official_url <> '' THEN 1 ELSE 0 END),
  'f_indexable', SUM(CASE WHEN is_indexable = 1 THEN 1 ELSE 0 END)
) FROM facility;

-- coverageByType（/data/ の種別内訳）
INSERT OR REPLACE INTO agg (key, value)
SELECT 'coverageByType', COALESCE(json_group_array(json_object(
  'service_type', service_type, 'service_type_slug', service_type_slug, 'n', n,
  'f_capacity', f_capacity, 'f_url', f_url)), '[]')
FROM (
  SELECT service_type, service_type_slug, COUNT(*) AS n,
         SUM(CASE WHEN capacity IS NOT NULL AND capacity > 0 AND capacity <= 1000 THEN 1 ELSE 0 END) AS f_capacity,
         SUM(CASE WHEN official_url IS NOT NULL AND official_url <> '' THEN 1 ELSE 0 END) AS f_url
  FROM facility GROUP BY service_type_slug, service_type ORDER BY n DESC
);

-- sitemap の施設ID（index 対象のみ・id順）
INSERT OR REPLACE INTO agg (key, value)
SELECT 'indexableFacilityIds', COALESCE(json_group_array(id), '[]')
FROM (SELECT id FROM facility WHERE is_indexable = 1 ORDER BY id);

-- sitemap の市区町村（施設1件以上・pref_slug, city_slug 順）。[[pref_slug, city_slug], ...]
-- lib/db.ts sitemapAreaSlugs の live と同じ条件・並び順。
INSERT OR REPLACE INTO agg (key, value)
SELECT 'sitemapAreas', COALESCE(json_group_array(json_array(pref_slug, city_slug)), '[]')
FROM (SELECT pref_slug, city_slug FROM area WHERE facility_count > 0 ORDER BY pref_slug, city_slug);

-- sitemap の法人 slug（/hojin/sitemap.xml）。事業所1件以上＝listRobots で index になる法人すべて。
-- 並びは facility_count DESC, slug（lib/db.ts allCorporationSlugs の live と同じ）。
INSERT OR REPLACE INTO agg (key, value)
SELECT 'corporationSlugs', COALESCE(json_group_array(slug), '[]')
FROM (SELECT slug FROM corporation WHERE facility_count > 0 ORDER BY facility_count DESC, slug);
