-- かいごDB スキーマ
-- 出典データ: 厚生労働省「介護サービス情報公表システム」オープンデータ (CC BY 4.0)
--
-- 設計方針:
--  - 欠損は NULL のまま保持する。推測値・仮値は一切入れない（表示側で「記載なし」と出す）。
--  - 正規化テーブル(corporation / area / place)は import 時に facility から集計して作る。
--  - meta は「データ取得日」などの出典表示に必要な値を持つ。

DROP TABLE IF EXISTS facility;
DROP TABLE IF EXISTS corporation;
DROP TABLE IF EXISTS area;
DROP TABLE IF EXISTS place;
DROP TABLE IF EXISTS meta;

-- ---------------------------------------------------------------------------
-- facility: 事業所（1行1事業所×1サービス種別）
-- ---------------------------------------------------------------------------
CREATE TABLE facility (
  -- URL用ID。「事業所番号-サービス種別スラッグ」の複合値。
  --   例: 0170100754-group-home
  -- 事業所番号(10桁)は全国で一意ではない。同一の事業所番号で複数サービスの指定を
  -- 受けている事業所があり、実データ31,441行のうち103行が「番号は同じだが種別が違う」
  -- 別事業所だった（特養とグループホームの併設など）。番号だけを主キーにすると
  -- これらを取りこぼすため、種別まで含めた複合IDにしている。
  -- （番号・種別まで同じ重複が2件だけ存在する。事業所名+住所の昇順で2件目以降に -2, -3 を付す）
  id                TEXT PRIMARY KEY,
  -- 出典の事業所番号（10桁）。一意ではないので主キーには使わない。表示・突合用。
  jigyosho_no       TEXT NOT NULL,
  name              TEXT NOT NULL,
  -- サービス種別（例: 有料老人ホーム）。CSVのファイル単位で決まる。
  service_type      TEXT NOT NULL,
  -- URL用スラッグ。既知種別は固定スラッグ、未知種別は svc-xxxxxxxx を import が振る。
  service_type_slug TEXT NOT NULL,
  -- 入居系(有料老人ホーム/グループホーム/特養/老健)なら1、在宅系なら0。
  is_residential    INTEGER NOT NULL DEFAULT 0,
  -- 郵便番号。今回の出典CSV（24列）には郵便番号の列が無いため常に NULL。
  -- 将来別の出典を足したときのために列だけ残している。
  postal_code       TEXT,
  prefecture        TEXT,
  pref_slug         TEXT,
  city              TEXT,
  city_slug         TEXT,
  -- 住所。出典の「住所」列をそのまま入れる。
  -- 出典の「方書（ビル名等）」は実データ2,642件すべてが「住所」列にも含まれていたため
  -- 連結していない（連結すると建物名が二重になる）。含まれていない行があれば import が連結する。
  -- 「住所」列は都道府県から始まる行(81.6%)と市区町村から始まる行が混在するので、
  -- 都道府県・市区町村が欠けている行にだけ同じ行の値を前置して、全行を同じ粒度に揃える。
  address           TEXT,
  lat               REAL,
  lng               REAL,
  tel               TEXT,
  -- 法人番号（13桁）。実測の充足率98.3%。空の行は法人ページを持たない（下記 corporation 参照）。
  corporate_number  TEXT,
  -- 運営法人名。法人番号がある行は「同一法人番号の中で最も多く出現した表記」に揃えてある
  -- （出典には「社会福祉法人札幌慈啓会」と「社会福祉法人　札幌慈啓会」のような表記ゆれがあるため）。
  -- 法人番号が無い行は出典の表記をそのまま入れる。
  corporation_name  TEXT,
  -- corporation.slug への参照。法人番号が無い行は NULL（法人ページを作らないため）。
  corporation_slug  TEXT,
  -- 定員。出典は空欄と 0 が混在する（0は「未記入」の意味で使われている）。
  -- 0以下は NULL として扱う。実測: 非空93.5% / 1以上51.1%。
  capacity          INTEGER,
  -- 利用可能曜日（原文のまま）。今回の入居系4種別では出典が全行空のため常に NULL。
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
CREATE INDEX idx_facility_no         ON facility(jigyosho_no);

-- ---------------------------------------------------------------------------
-- corporation: 運営法人
--
-- 名寄せは「法人名」ではなく「法人番号（13桁）」で行う。
-- 法人名で寄せると表記ゆれ（全角スペースの有無・法人格の位置）で同じ法人が複数ページに
-- 割れ、逆に同名の別法人が1ページに混ざる。法人番号は国税庁が振る一意の番号なのでどちらも起きない。
--
-- 法人番号が空の事業所（実測1.7%＝538件）は、ここに行を作らない＝法人ページを作らない。
-- その事業所の施設ページには出典の法人名をそのまま表示し、法人ページへのリンクは張らない。
-- （法人名だけでページを作ると、別法人を同一視する／同一法人を分割する事故が起きるため）
-- ---------------------------------------------------------------------------
CREATE TABLE corporation (
  -- 'c' + 法人番号13桁（例: c3430005000627）。法人番号が変わらない限りURLは変わらない。
  slug              TEXT PRIMARY KEY,
  -- 法人番号13桁そのもの。
  corporate_number  TEXT NOT NULL,
  -- 表示名。同一法人番号の中で最も多く出現した表記を採用する
  -- （比較時は全角・半角スペースを除去して正規化。同数のときは文字列昇順で固定）。
  name              TEXT NOT NULL,
  facility_count    INTEGER NOT NULL DEFAULT 0,
  -- 展開都道府県数（一覧の並べ替え用）
  pref_count        INTEGER NOT NULL DEFAULT 0,
  -- 出典に現れた表記の異なり数（1より大きい＝表記ゆれを名寄せした法人）
  name_variants     INTEGER NOT NULL DEFAULT 1
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
-- place: 住所・地名の検索辞書（トップページの「住所で探す」用）
--
-- 外部のジオコーディングAPIは使わない（キーが要る・従量課金・障害点が増える）。
-- 掲載施設の緯度経度は100%埋まっているので、都道府県／市区町村／町名ごとに
-- その区域の施設の緯度経度の平均を取り、地名→座標の対応表を import 時に作る。
-- したがってここに入るのは「実データから計算した代表点」であって、行政が定める
-- 役所の位置や町の重心ではない。検索の起点としてのみ使う。
-- ---------------------------------------------------------------------------
CREATE TABLE place (
  -- 検索キー。NFKC正規化して空白を除いた文字列（例: とうきょうと世田谷区成城 → 東京都世田谷区成城）。
  key             TEXT PRIMARY KEY,
  -- 表示名（「東京都世田谷区成城」）
  name            TEXT NOT NULL,
  -- 'pref' | 'city' | 'town'
  kind            TEXT NOT NULL,
  pref_slug       TEXT,
  city_slug       TEXT,
  -- その区域の施設の緯度経度の平均（代表点）
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  -- 代表点の算出に使った施設数（多いほど代表点として安定している）
  facility_count  INTEGER NOT NULL
);

CREATE INDEX idx_place_kind ON place(kind, facility_count DESC);

-- ---------------------------------------------------------------------------
-- meta: サイト表示に使うメタ情報
--   acquired_on     : データ取得日 YYYY-MM-DD（CC BY表示に使う。必須）
--   source_name     : 出典名
--   source_url      : 出典URL
--   license         : ライセンス表記
--   imported_at     : import 実行日時
--   facility_total  : 取り込み件数
--   corporation_total / area_total / area_total_3plus / capacity_median : トップページの実測値
-- ---------------------------------------------------------------------------
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
