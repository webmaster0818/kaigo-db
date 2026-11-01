# かいごDB（kaigo-db）

厚生労働省「介護サービス情報公表システム」オープンデータ（CC BY 4.0）を、
住所・地名からの距離、運営法人（法人番号）、市区町村、サービス種別で引ける形にした介護施設データベース。

**現状：2026-09-29 取得の入居系4種別 31,441件を取り込み済み。**
（特養8,543 / 老健4,121 / グループホーム14,310 / 有料老人ホーム4,467）
架空データ・サンプルDBは作っていない。データ0件でも全ページが落ちずに「データ準備中」を出す。

本番ドメイン: `kaigo-database.com`（`lib/site.ts`）。

---

## 技術構成

personal-gym-navi と同じ構成を踏襲。

| 項目 | 内容 |
| --- | --- |
| フレームワーク | Next.js (App Router) |
| デプロイ | OpenNext + Cloudflare Workers |
| DB | Cloudflare D1（本番） / better-sqlite3（開発） |
| レンダリング | 全ページ `export const dynamic = "force-dynamic"`（再ビルドせずデータ更新できる） |
| DB切替 | `lib/db.ts`：本番 `getCloudflareContext().env.DB` ／ 開発 `data/kaigo.sqlite` |

---

## 掲載方針（施主承認済み）

1. **欠損は推測で埋めない。**空欄は「記載なし」と表示する。
2. **公式URLか定員のいずれかがある施設のみ index。**それ以外は `noindex, follow`。判定は `lib/indexing.ts` の `isIndexableFacility()` に集約（import 時の `facility.is_indexable` とページの `robots` が同じ関数を使う）。
3. **CC BY 4.0 の出典表示を、データを使う全ページの本文内に出す**（`components/SourceNote.tsx`）。取得日は `meta.acquired_on` から読む。
4. **口コミ・独自評価は作らない。**星・点数・おすすめ・No.1 などの評価表現も使わない。
5. **複数項目を重み付けして合成した「総合ランキング」は作らない。**重みの根拠を説明できないため。
   代わりに、公表データの値そのもの1本で並べ替えた一覧（`/ranking/*`）を置く。
   各ページに「何の値で並べているか」と「この並び順は当サイトによる評価・推薦ではありません」を必ず書く（`lib/ranking.ts` に文言を集約）。
6. **法人の名寄せキーは法人名ではなく法人番号（13桁）。**表記ゆれ（全角スペースの有無など）で
   同一法人が複数ページに割れる／同名の別法人が混ざる、どちらも防ぐため。
   法人番号が無い事業所（実測1.7%＝538件）は法人ページを作らず、施設ページに出典の法人名だけを出す。
   法人ページの表示名は、同一法人番号の中で最も多く出現した表記を採用する。
7. **電話相談の窓口は作らない。**相談員が居らず、助言できる体制を持たないため。
8. **地名→座標の変換に外部APIを使わない。**掲載施設の緯度・経度から `place` テーブル（地名辞書）を
   import 時に作り、それを引く。掲載施設が無い地域の地名は「見つかりません」と正直に返す。

---

## ディレクトリ

```
schema.sql                     D1/SQLite スキーマ（facility / corporation / area / place / meta）
scripts/import.ts              CSV → SQLite + D1投入用SQL
lib/db.ts                      D1 / better-sqlite3 抽象化（データ無しでも落ちない）
lib/geo.ts                     Haversine + バウンディングボックス（D1に三角関数が無い前提）
lib/indexing.ts                index/noindex 判定（施設 + 並べ替え一覧）
lib/ranking.ts                 並べ替えの軸の定義・共通文言・クエリパラメータの検証
lib/serviceTypes.ts            サービス種別 → スラッグ（未知種別は svc-<hash> を自動採番）
lib/slug.ts                    都道府県・市区町村・法人のスラッグ生成
lib/site.ts                    サイト定数・出典情報・「記載なし」
components/                    SiteHeader / Footer / Breadcrumb / FacilityTable / SourceNote / EmptyState / RankingNote / RankingFilter / PlaceSearchForm
app/page.tsx                   / … 住所・地名（または現在地）＋距離での検索 ＋ 運営法人・種別・エリア・並べ替えへの導線
app/area/page.tsx              /area/ … 都道府県一覧
app/area/[pref]/page.tsx       /area/tokyo/ … 市区町村一覧
app/area/[pref]/[city]/page.tsx /area/tokyo/世田谷区/ … 施設一覧
app/facility/[id]/page.tsx     /facility/0170100754-group-home/ … 施設詳細（ID＝事業所番号-種別スラッグ）
app/type/page.tsx              /type/ … サービス種別一覧
app/type/[type]/page.tsx       /type/tokuyo/ … 種別ごとの一覧
app/hojin/[slug]/page.tsx      /hojin/c3430005000635/ … 法人ごとの事業所（スラッグ＝c+法人番号13桁）
（Next ルートなし）            /type/group-home/shizuoka/長泉町/ … 種別×市区町村（worker.ts → lib/direct.ts renderTypeCity・lib/typeCity.ts）
app/type/sitemap.ts            /type/sitemap.xml … 種別×市区町村ページの sitemap
app/ranking/page.tsx           /ranking/ … 並べ替えの軸の一覧（根拠を1行で説明）
app/ranking/capacity/page.tsx  /ranking/capacity/ … 定員が多い順（定員の記載がある施設のみ）
app/ranking/hojin-scale/page.tsx /ranking/hojin-scale/ … 同一法人の運営施設数が多い順
app/ranking/area-density/page.tsx /ranking/area-density/ … 市区町村あたりの施設数が多い順
app/data/page.tsx              /data/ … 件数と項目ごとの充足率
app/sitemap.ts / app/robots.ts index対象のみを sitemap に出す
```

---

## 種別×市区町村ページ（2026-11-01 okina 承認・Discord 1566311131004276757）

URL: `/type/{種別スラッグ}/{都道府県スラッグ}/{市区町村}/`（例 `/type/group-home/shizuoka/長泉町/`）。
対象: 掲載中4種別 × 市区町村のうち、**index 対象施設（公式URLか定員の記載あり）が3件以上**の組み合わせ。
2026-09-29 取得分で **2,965ページ**（施設数の合計27,249・1ページ平均9.2件・最大130件＝愛媛県松山市のグループホーム）。
3件未満はページを作らない（404・sitemap に載せない）。作ったページはすべて index・自己参照 canonical。

### 既存ページのデータ取得（調査結果）

| ページ | 描画 | D1 の読み方 |
| --- | --- | --- |
| `/area/[pref]/[city]/` | Next（force-dynamic）＋ worker.ts の HTML キャッシュ | `facilitiesByCity`（idx_facility_city・該当行）＋ area 1行。meta はキャッシュ |
| `/type/[type]/` | Next＋HTML キャッシュ | 一覧・都道府県内訳とも cachedAgg（agg 1行） |
| `/facility/`・`/hojin/` | worker.ts → lib/direct.ts（Next を通さない） | 1件取得＋cachedAgg |

Next の描画は1回 CPU 20〜60ms で、無料プランの上限 10ms を超えた分が 503 になる（10/22〜10/28 の調査）。
巡回は毎回別 URL なので HTML キャッシュは初回描画を減らせない。3千の新 URL を Next で描画すると、
初回巡回のたびに CPU 超過を増やすことになる。

### 設計

1. **描画は lib/direct.ts `renderTypeCity`（Next を通さず文字列を組み立てる）。** Next のルートは置かない。
   ローカル計測で1回 0.1〜0.6ms（130件のページで0.56ms・SQL を除く）。
2. **D1 は索引付きの1クエリだけ。** `WHERE service_type_slug=? AND pref_slug=? AND city_slug=?` は
   既存の `idx_facility_type_city`（本番 D1 に存在を確認済み）で該当行だけを読む。
   本番実測：松山市のグループホーム（130件）で rows_read 261（≒2×件数+1）。全件走査は無い。
   3件未満かどうかも同じ結果から数える（追加の読み取りなし）。存在しない組み合わせは0〜1行。
3. **関連リンク・都道府県内の比率は事前計算を使う。** agg `typeCityCombos`（scripts/agg.sql で作る組み合わせ一覧・1行）と
   既存の agg `typePref:<種別>`。どちらも lib/db.ts と同じキーの cachedAgg（isolate 内メモ＋Cache API 6時間）。外れても1行。
4. **描画済み HTML を Cache API に保存（worker.ts `serveTypeCity`）。** 同じ URL の2回目以降は D1 を読まない。
   キーはクエリを外した URL（`?utm_…` などで別キーを増やさない）。D1 の失敗は 503（404 にしない）。
5. **sitemap は `/type/sitemap.xml` に分ける**（agg 1行・2,965 URL。5万URL以下）。`/sitemap_index.xml`・robots.txt に追加。
   worker.ts の XML キャッシュ（CACHED_XML）にも入れた。
6. 市区町村ページの種別チップは、3件以上の種別だけ種別×市区町村ページへの通常のリンク（`<a>`）にした
   （Next のルートが無いので next/link のプリフェッチをさせない）。

### D1 読み取りの見積もり（日次上限 500万行）

| 項目 | 行/日 | 上限比 |
| --- | ---: | ---: |
| 現状（`wrangler d1 info` rows_read_24h、2026-11-01 13:45 JST） | 430,032 | 8.6% |
| 直近の最大（10/30 UTC 日、growth/okina/kaigo-check） | 809,165 | 16.2% |
| 新ページ：全2,965ページを1日1回ずつ巡回（キャッシュ全外れ） | 約57,500（2×27,249＋2,965） | 1.2% |
| 新ページ：bot 合計で全ページを1日5回（キャッシュ全外れの最悪値） | 約287,000 | 5.7% |
| sitemap・関連リンクの agg（6時間キャッシュ・データセンターごと） | 数百 | 0.0% |
| agg `typeCityCombos` の作成（本番で1回だけ。facility 全件の GROUP BY） | 約6万（1回） | 1.3%（当日のみ） |

最悪値どうしを足しても 約110万行（約22%）で、30%を下回る。巡回数が想定より大きく増えた場合は、
rows 取得を cachedAgg（`typeCity:<種別>/<都道府県>/<市区町村>`）で包めばデプロイをまたいでも再読しなくなる。

### データ更新時

`scripts/deploy.sh load`（agg.sql の全体を含む）→ `ship` で、組み合わせ一覧と HTML キャッシュが入れ替わる。
agg `typeCityCombos` だけを本番で作り直すときは、scripts/agg.sql の BEGIN〜END の1文を流す:

```bash
npx wrangler d1 execute kaigo-db --remote --yes \
  --command "$(sed -n '/^-- BEGIN typeCityCombos/,/^-- END typeCityCombos/{/^--/!p;}' scripts/agg.sql)"
```

---

## CSVが届いたあとの手順

### 0. 準備

```bash
cd /Users/jiro.hasegawa/.openclaw/workspace/projects/kaigo-db
npm install
mkdir -p raw/20260929        # CSV をここに置く（raw/ は .gitignore 済み）
```

### 1. まず列名を確認（DBは作らない）

```bash
npm run import -- ./raw/20260929 --acquired 2026-09-29 --dry-run
```

- 「未マッピングの列」「未知のサービス種別」「未知の都道府県表記」が **3つとも0件** になることを確認してから本実行する。
- 未マッピングの列が出たら、`scripts/import.ts` の `COLUMN_MAP`（取り込む）か `IGNORED_COLUMNS`（理由を書いて捨てる）のどちらかに必ず追記する。
- 未知のサービス種別が出たら `lib/serviceTypes.ts` に追記する。
- CSVの先頭に説明行がある場合は `--header-row 2` のように指定する。

### 2. 取り込み（SQLite + D1投入用SQL を生成）

```bash
npm run import -- ./raw/20260929 --acquired 2026-09-29
# → data/kaigo.sqlite（開発サーバ用）
# → data/d1/000_schema.sql, 001_facility.sql …, *_corporation.sql, *_place.sql, *_area_meta.sql
#   （D1投入用。2000行ずつ分割。2026-09-29分で57ファイル・約37MB）
```

`--acquired`（データ取得日）は必須。CC BY 表示の「取得日」に使う。

### 3. ローカル確認

```bash
npm run dev     # http://localhost:3000
npm run build   # 本番ビルドが通るか
```

### 4. D1 を作成して投入

```bash
npx wrangler d1 create kaigo-db
# 出力された database_id を wrangler.jsonc の d1_databases[0].database_id に貼る
# （account_id も必要なら追記）

for f in data/d1/*.sql; do
  npx wrangler d1 execute kaigo-db --remote --file="$f" --yes
done

# 件数確認
npx wrangler d1 execute kaigo-db --remote --command "SELECT COUNT(*) FROM facility;"
```

### 5. デプロイ

```bash
npx opennextjs-cloudflare build
npx wrangler deploy
```

### 6. データ更新（2回目以降）

`schema.sql` は冒頭で `DROP TABLE IF EXISTS` しているため、`000_schema.sql` から順に流し直せば全入れ替えになる。
ページは全て force-dynamic なので、**データを入れ替えても再ビルド・再デプロイは不要**。

---

## 未確定・要確認事項

- **駅名での検索**：駅の座標データを持っていない。ライセンスがはっきりした駅データ（国土数値情報 N02 など）を
  取り込むまでは、「〇〇駅」と入力されたら「駅」を外し、同名の地名の代表点で検索する（画面にその旨を明示している）。
- **市区町村のスラッグ**：ローマ字辞書が無いため日本語をそのままスラッグにしている（例 `/area/tokyo/世田谷区/`）。
  変えるなら `lib/slug.ts` の `citySlug()` を差し替えて再 import。法人スラッグは法人番号ベース（`c<法人番号>`）で確定済み。
- **出典データの緯度経度のずれ**：自分の市区町村の代表点から20km以上離れた行が671件（2.1%）ある。
  広い自治体もあるが、明らかな誤登録（横浜市の施設が新宿の座標）も混ざっている。距離検索の精度に直接効くので、
  出典が更新されたら再確認する。値の補正は行っていない（推測で書き換えない方針のため）。
- **`wrangler.jsonc` の `database_id`**：`PLACEHOLDER_RUN_WRANGLER_D1_CREATE` のまま。手順4で差し替える。
- **D1への投入**：未実施（本番D1が未作成のため）。手順4のとおり `data/d1/*.sql` を順に流す。

---

## 出典

本サイトのデータは厚生労働省「介護サービス情報公表システム」の公開データ（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)）を利用しています。
