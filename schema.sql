-- かいごDB スキーマ
-- 出典データ: 厚生労働省「介護サービス情報公表システム」オープンデータ (CC BY 4.0)
--
-- 設計方針:
--  - 欠損は NULL のまま保持する。推測値・仮値は一切入れない（表示側で「記載なし」と出す）。
--  - 正規化テーブル(corporation / area)は import 時に facility から集計して作る。
--  - meta は「データ取得日」などの出典表示に必要な値を持つ。

DROP TABLE IF EXISTS facility;
DROP TABLE IF EXISTS corporation;
DROP TABLE IF EXISTS area;
DROP TABLE IF EXISTS meta;

-- ---------------------------------------------------------------------------
-- facility: 事業所（1行1事業所）
-- ---------------------------------------------------------------------------
CREATE TABLE facility (
  -- 事業所番号（厚労省の10桁コード）。全国で一意なため主キーに使う。
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  -- サービス種別（例: 有料老人ホーム）。CSVのファイル単位で決まる。
  service_type      TEXT NOT NULL,
  -- URL用スラッグ。既知種別は固定スラッグ、未知種別は svc-xxxxxxxx を import が振る。
  service_type_slug TEXT NOT NULL,
  -- 入居系(有料老人ホーム/グループホーム/特養/老健)なら1、在宅系なら0。
  is_residential    INTEGER NOT NULL DEFAULT 0,
  postal_code       TEXT,
  prefecture        TEXT,
  pref_slug         TEXT,
  city              TEXT,
  city_slug         TEXT,
  address           TEXT,
  lat               REAL,
  lng               REAL,
  tel               TEXT,
  corporation_name  TEXT,
  corporation_slug  TEXT,
  -- 定員。実測の充足率は約45.9%なので NULL が半数以上ある前提。
  capacity          INTEGER,
  -- 利用可能曜日（原文のまま。例: 月火水木金土日）
  open_days         TEXT,
  official_url      TEXT,
  -- この行のもとになったCSVの取得日 (YYYY-MM-DD)
  acquired_on       TEXT,
  -- import が計算する索引許可フラグ（lib/indexing.ts と同じ判定）。
  -- 公式URLか定員のどちらかがある行のみ 1。
  is_indexable      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_facility_lat        ON facility(lat);
CREATE INDEX idx_facility_lng        ON facility(lng);
CREATE INDEX idx_facility_latlng     ON facility(lat, lng);
CREATE INDEX idx_facility_city       ON facility(pref_slug, city_slug);
CREATE INDEX idx_facility_corp       ON facility(corporation_slug);
CREATE INDEX idx_facility_type       ON facility(service_type_slug);
CREATE INDEX idx_facility_type_city  ON facility(service_type_slug, pref_slug, city_slug);
CREATE INDEX idx_facility_name       ON facility(name);

-- ---------------------------------------------------------------------------
-- corporation: 法人
-- ---------------------------------------------------------------------------
CREATE TABLE corporation (
  slug            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  facility_count  INTEGER NOT NULL DEFAULT 0,
  -- 展開都道府県数（一覧の並べ替え用）
  pref_count      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_corporation_count ON corporation(facility_count DESC);

-- ---------------------------------------------------------------------------
-- area: 市区町村（pref_slug + city_slug で一意）
-- ---------------------------------------------------------------------------
CREATE TABLE area (
  pref_slug       TEXT NOT NULL,
  prefecture      TEXT NOT NULL,
  city_slug       TEXT NOT NULL,
  city            TEXT NOT NULL,
  facility_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pref_slug, city_slug)
);

CREATE INDEX idx_area_pref  ON area(pref_slug);
CREATE INDEX idx_area_count ON area(facility_count DESC);

-- ---------------------------------------------------------------------------
-- meta: サイト表示に使うメタ情報
--   acquired_on     : データ取得日 YYYY-MM-DD（CC BY表示に使う。必須）
--   source_name     : 出典名
--   source_url      : 出典URL
--   license         : ライセンス表記
--   imported_at     : import 実行日時
--   facility_total  : 取り込み件数
-- ---------------------------------------------------------------------------
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
