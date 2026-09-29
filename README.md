# かいごDB（kaigo-db）

厚生労働省「介護サービス情報公表システム」オープンデータ（CC BY 4.0）を、
現在地からの距離・市区町村・サービス種別・運営法人で引ける形にした介護施設データベース。

**現状：データ本体（CSV）未着。CSVが届いたら `npm run import` を流すだけで公開できる状態まで作ってある。**
架空データ・サンプルDBは作っていない（`data/sample.sqlite` は存在しない）。データ0件でも全ページが落ちずに「データ準備中」を出す。

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

---

## ディレクトリ

```
schema.sql                     D1/SQLite スキーマ
scripts/import.ts              CSV → SQLite + D1投入用SQL
lib/db.ts                      D1 / better-sqlite3 抽象化（データ無しでも落ちない）
lib/geo.ts                     Haversine + バウンディングボックス（D1に三角関数が無い前提）
lib/indexing.ts                index/noindex 判定（施設 + 並べ替え一覧）
lib/ranking.ts                 並べ替えの軸の定義・共通文言・クエリパラメータの検証
lib/serviceTypes.ts            サービス種別 → スラッグ（未知種別は svc-<hash> を自動採番）
lib/slug.ts                    都道府県・市区町村・法人のスラッグ生成
lib/site.ts                    サイト定数・出典情報・「記載なし」
components/                    SiteHeader / Footer / Breadcrumb / FacilityTable / SourceNote / EmptyState / GeoSearchForm
app/page.tsx                   / … 緯度経度＋距離での検索
app/area/page.tsx              /area/ … 都道府県一覧
app/area/[pref]/page.tsx       /area/tokyo/ … 市区町村一覧
app/area/[pref]/[city]/page.tsx /area/tokyo/世田谷区/ … 施設一覧
app/facility/[id]/page.tsx     /facility/1370100001/ … 施設詳細
app/type/page.tsx              /type/ … サービス種別一覧
app/type/[type]/page.tsx       /type/tokuyo/ … 種別ごとの一覧
app/hojin/[slug]/page.tsx      /hojin/<法人スラッグ>/ … 法人ごとの事業所
app/ranking/page.tsx           /ranking/ … 並べ替えの軸の一覧（根拠を1行で説明）
app/ranking/capacity/page.tsx  /ranking/capacity/ … 定員が多い順（定員の記載がある施設のみ）
app/ranking/hojin-scale/page.tsx /ranking/hojin-scale/ … 同一法人の運営施設数が多い順
app/ranking/area-density/page.tsx /ranking/area-density/ … 市区町村あたりの施設数が多い順
app/data/page.tsx              /data/ … 件数と項目ごとの充足率
app/sitemap.ts / app/robots.ts index対象のみを sitemap に出す
```

---

## CSVが届いたあとの手順

### 0. 準備

```bash
cd /Users/jiro.hasegawa/.openclaw/workspace/projects/kaigo-db
npm install
mkdir -p raw/20260901        # CSV 35本をここに置く（raw/ は .gitignore 済み）
```

### 1. まず列名を確認（DBは作らない）

```bash
npm run import -- ./raw/20260901 --acquired 2026-09-01 --dry-run
```

- 「未マッピングの列」「未知のサービス種別」「未知の都道府県表記」が警告で出る。
- 必要に応じて `scripts/import.ts` の `COLUMN_MAP` と `lib/serviceTypes.ts` に追記する。
- CSVの先頭に説明行がある場合は `--header-row 2` のように指定する。

### 2. 取り込み（SQLite + D1投入用SQL を生成）

```bash
npm run import -- ./raw/20260901 --acquired 2026-09-01
# → data/kaigo.sqlite（開発サーバ用）
# → data/d1/000_schema.sql, 001_facility.sql … （D1投入用。2000行ずつ分割）
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

- **列名**：実CSV未着のため `COLUMN_MAP` は公表システムの一般的な列名からの推定。初回は必ず `--dry-run` で確認する。
- **市区町村・法人のスラッグ**：ローマ字辞書が無いため暫定で日本語をそのままスラッグにしている（例 `/area/tokyo/世田谷区/`）。変えるなら `lib/slug.ts` の `citySlug()` / `corpSlugBase()` を差し替えて再 import。
- **本番ドメイン**：未定。`lib/site.ts` の `SITE_URL`（既定 `https://kaigo-db.jp`）を決定後に書き換えるか、`NEXT_PUBLIC_SITE_URL` を設定する。canonical・JSON-LD・sitemap がこの値を使う。
- **住所・駅名での検索**：ジオコーディングAPI未接続。現状は緯度経度のみ。
- **`wrangler.jsonc` の `database_id`**：`PLACEHOLDER_RUN_WRANGLER_D1_CREATE` のまま。手順4で差し替える。

---

## 出典

本サイトのデータは厚生労働省「介護サービス情報公表システム」の公開データ（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)）を利用しています。
