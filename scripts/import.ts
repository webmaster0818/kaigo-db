/**
 * 厚労省「介護サービス情報公表システム」オープンデータCSV → SQLite / D1投入用SQL
 *
 * 使い方:
 *   npm run import -- <CSVディレクトリ> [options]
 *
 * 例:
 *   npm run import -- ./raw/20260901 --acquired 2026-09-01
 *   npm run import -- ./raw/20260901 --acquired 2026-09-01 --header-row 2
 *   npm run import -- ./raw/20260901 --dry-run     # DBを作らず列マッピングだけ確認
 *
 * options:
 *   --acquired YYYY-MM-DD  データ取得日（必須。meta.acquired_on に入り、全ページの出典表示に使う）
 *   --out PATH             SQLiteの出力先 (default: data/kaigo.sqlite)
 *   --sql-dir PATH         D1投入用SQLの出力先 (default: data/d1)
 *   --header-row N         ヘッダー行の行番号 (default: 1)。CSVの先頭に説明行がある場合に指定。
 *   --chunk N              1つのSQLファイルに入れる行数 (default: 2000)
 *   --dry-run              解析だけ行い、出力しない
 *
 * 方針:
 *   - 欠損は NULL のまま入れる（0や空文字で埋めない／推測しない）
 *   - 列名の揺れは COLUMN_MAP で吸収し、想定外の列は「警告して無視」。落とさない。
 */

import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import Database from "better-sqlite3";
import { corpSlugBase, citySlug, prefSlug, shortHash } from "../lib/slug";
import { resolveServiceType } from "../lib/serviceTypes";
import { isIndexableFacility } from "../lib/indexing";
import { isValidJapanLatLng } from "../lib/geo";

// ---------------------------------------------------------------------------
// 列名マッピング
//   キー = DBの列、値 = CSVで来うるヘッダー名の候補（上から優先）
//   【未確定】実CSVが未着のため、公表システムの一般的な列名から推定した候補を並べている。
//   実データが来たら --dry-run の "未マッピングの列" 警告を見て、ここに追記すれば足りる。
// ---------------------------------------------------------------------------
const COLUMN_MAP: Record<string, string[]> = {
  id: ["事業所番号", "事業所番号（10桁）", "事業所番号(10桁)", "介護事業所番号", "事業所コード", "NO"],
  name: ["事業所名", "事業所の名称", "事業所名称", "名称", "施設名"],
  postal_code: ["郵便番号", "事業所の所在地（郵便番号）", "所在地（郵便番号）", "事業所郵便番号"],
  prefecture: ["都道府県", "都道府県名", "事業所の所在地（都道府県）", "所在地（都道府県）"],
  city: ["市区町村", "市区町村名", "事業所の所在地（市区町村）", "所在地（市区町村）", "市町村"],
  address: [
    "住所",
    "所在地",
    "事業所の所在地",
    "事業所の所在地（詳細）",
    "所在地（詳細）",
    "事業所所在地",
    "町名番地",
  ],
  lat: ["緯度", "事業所の緯度", "北緯", "緯度（世界測地系）"],
  lng: ["経度", "事業所の経度", "東経", "経度（世界測地系）"],
  tel: ["電話番号", "事業所の電話番号", "TEL", "連絡先電話番号"],
  corporation_name: ["法人名", "法人の名称", "事業所の法人名", "運営法人名", "法人等の名称", "事業者名"],
  capacity: ["定員", "利用定員", "入所定員", "定員（人）", "定員数", "入居定員"],
  open_days: ["利用可能曜日", "営業日", "サービス提供曜日", "営業曜日", "サービス提供日"],
  official_url: [
    "公式URL",
    "ホームページアドレス",
    "ホームページ",
    "URL",
    "事業所のホームページ",
    "事業所ホームページ",
    "ＵＲＬ",
  ],
  service_type: ["サービス種別", "サービスの種類", "サービス名", "サービス種類", "サービス種類名"],
};

/** CSVを読み飛ばしても致命的でない列（警告の抑制用） */
const IGNORED_HINTS = ["フリガナ", "かな", "備考", "更新日", "登録日", "調査", "事業所番号枝番"];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
interface Options {
  dir: string;
  acquired: string;
  out: string;
  sqlDir: string;
  headerRow: number;
  chunk: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const args = argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const get = (name: string, def?: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
  };
  if (!dir) {
    console.error("使い方: npm run import -- <CSVディレクトリ> --acquired YYYY-MM-DD");
    process.exit(1);
  }
  const acquired = get("acquired", "") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acquired)) {
    console.error("エラー: --acquired YYYY-MM-DD （データ取得日）は必須です。CC BY表示に使います。");
    process.exit(1);
  }
  return {
    dir,
    acquired,
    out: get("out", "data/kaigo.sqlite")!,
    sqlDir: get("sql-dir", "data/d1")!,
    headerRow: Number(get("header-row", "1")),
    chunk: Number(get("chunk", "2000")),
    dryRun: args.includes("--dry-run"),
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** UTF-8として妥当ならUTF-8、そうでなければCP932(Shift_JIS)として読む */
function decodeBuffer(buf: Buffer, file: string): string {
  const stripBom = (s: string) => s.replace(/^﻿/, "");
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return stripBom(utf8);
  } catch {
    if (!iconv.encodingExists("cp932")) {
      throw new Error(`${file}: cp932 デコーダが使えません`);
    }
    return stripBom(iconv.decode(buf, "cp932"));
  }
}

/** RFC4180 準拠の簡易パーサ（引用符内の改行・""エスケープに対応） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

const toHankaku = (s: string) =>
  s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[‐－―ー−]/g, "-");

function clean(v: string | undefined): string | null {
  if (v == null) return null;
  const s = v.replace(/　/g, " ").trim();
  if (s === "" || s === "-" || s === "―" || s === "なし" || s === "非該当") return null;
  return s;
}

function normPostal(v: string | undefined): string | null {
  const s = clean(v);
  if (!s) return null;
  const digits = toHankaku(s).replace(/[^0-9]/g, "");
  if (digits.length !== 7) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function normTel(v: string | undefined): string | null {
  const s = clean(v);
  if (!s) return null;
  const t = toHankaku(s).replace(/[()（）\s]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return /[0-9]/.test(t) ? t : null;
}

function normUrl(v: string | undefined): string | null {
  const s = clean(v);
  if (!s) return null;
  const t = toHankaku(s).replace(/\s/g, "");
  if (/^https?:\/\/\S+\.\S+/.test(t)) return t;
  if (/^www\.\S+\.\S+/.test(t)) return `https://${t}`;
  return null; // 「準備中」「あり」などは URL として扱わない
}

function normInt(v: string | undefined): number | null {
  const s = clean(v);
  if (!s) return null;
  const n = parseInt(toHankaku(s).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normFloat(v: string | undefined): number | null {
  const s = clean(v);
  if (!s) return null;
  const n = parseFloat(toHankaku(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

interface FacilityRecord {
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
  acquired_on: string;
  is_indexable: number;
}

function buildHeaderIndex(header: string[]): { map: Record<string, number>; unmapped: string[] } {
  const norm = header.map((h) => h.replace(/\s|　/g, "").replace(/^"|"$/g, ""));
  const map: Record<string, number> = {};
  const used = new Set<number>();

  for (const [field, candidates] of Object.entries(COLUMN_MAP)) {
    let idx = -1;
    for (const cand of candidates) {
      const c = cand.replace(/\s|　/g, "");
      idx = norm.findIndex((h, i) => !used.has(i) && h === c);
      if (idx >= 0) break;
    }
    if (idx < 0) {
      // 完全一致で見つからない場合のみ部分一致を試す
      for (const cand of candidates) {
        const c = cand.replace(/\s|　/g, "");
        idx = norm.findIndex((h, i) => !used.has(i) && h.includes(c));
        if (idx >= 0) break;
      }
    }
    if (idx >= 0) { map[field] = idx; used.add(idx); }
  }

  const unmapped = norm.filter((h, i) => h !== "" && !used.has(i) && !IGNORED_HINTS.some((k) => h.includes(k)));
  return { map, unmapped };
}

function main() {
  const opt = parseArgs(process.argv);
  const root = process.cwd();
  const dir = path.resolve(root, opt.dir);
  if (!fs.existsSync(dir)) {
    console.error(`エラー: ディレクトリが見つかりません: ${dir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.csv$/i.test(d.name))
    .map((d) => path.join(dir, d.name))
    .sort();

  if (files.length === 0) {
    console.error(`エラー: CSVが1件もありません: ${dir}`);
    process.exit(1);
  }
  console.log(`CSV ${files.length}本を読み込みます (${dir})`);

  const records = new Map<string, FacilityRecord>();
  const warnings: string[] = [];
  const unknownTypes = new Set<string>();
  // 法人スラッグ: base -> 法人名（同名別法人の衝突時は -2, -3 …）
  const corpSlugByName = new Map<string, string>();
  const corpNameBySlug = new Map<string, string>();
  let skippedNoId = 0;
  let duplicated = 0;

  for (const file of files) {
    const base = path.basename(file);
    const rows = parseCsv(decodeBuffer(fs.readFileSync(file), base));
    if (rows.length <= opt.headerRow) {
      warnings.push(`${base}: データ行がありません（--header-row の指定を確認してください）`);
      continue;
    }
    const header = rows[opt.headerRow - 1];
    const body = rows.slice(opt.headerRow);
    const { map, unmapped } = buildHeaderIndex(header);

    for (const req of ["id", "name"]) {
      if (map[req] === undefined) {
        warnings.push(`${base}: 必須列「${req}」に対応するヘッダーが見つかりません → このファイルはスキップ`);
      }
    }
    if (map.id === undefined || map.name === undefined) continue;
    if (unmapped.length > 0) {
      warnings.push(`${base}: 未マッピングの列 ${unmapped.length}件 → ${unmapped.slice(0, 12).join(" / ")}${unmapped.length > 12 ? " …" : ""}`);
    }

    // サービス種別: 列があればそれ、無ければファイル名から判定
    const typeFromFile = resolveServiceType(base.replace(/\.csv$/i, ""));
    let fileRowCount = 0;

    for (const r of body) {
      const cell = (field: string): string | undefined => {
        const i = map[field];
        return i === undefined ? undefined : r[i];
      };

      const id = clean(cell("id"))?.replace(/\s/g, "");
      const name = clean(cell("name"));
      if (!id || !name) { skippedNoId++; continue; }

      const rawType = clean(cell("service_type"));
      const st = rawType ? resolveServiceType(rawType) : typeFromFile;
      if (!st.known) unknownTypes.add(st.name);

      const prefecture = clean(cell("prefecture"));
      const city = clean(cell("city"));
      const pslug = prefSlug(prefecture);
      if (prefecture && !pslug) warnings.push(`${base}: 未知の都道府県表記「${prefecture}」`);

      const lat = normFloat(cell("lat"));
      const lng = normFloat(cell("lng"));
      const geoOk = isValidJapanLatLng(lat, lng);

      const corpName = clean(cell("corporation_name"));
      let corpSlug: string | null = null;
      if (corpName) {
        const existing = corpSlugByName.get(corpName);
        if (existing) corpSlug = existing;
        else {
          const base0 = corpSlugBase(corpName) || `corp-${shortHash(corpName)}`;
          let cand = base0;
          let n = 1;
          // 同名別法人（別スラッグ既存）なら連番を付す
          while (corpNameBySlug.has(cand) && corpNameBySlug.get(cand) !== corpName) {
            n += 1;
            cand = `${base0}-${n}`;
          }
          corpSlug = cand;
          corpSlugByName.set(corpName, cand);
          corpNameBySlug.set(cand, corpName);
        }
      }

      const capacity = normInt(cell("capacity"));
      const official_url = normUrl(cell("official_url"));

      const rec: FacilityRecord = {
        id,
        name,
        service_type: st.name,
        service_type_slug: st.slug,
        is_residential: st.residential ? 1 : 0,
        postal_code: normPostal(cell("postal_code")),
        prefecture,
        pref_slug: pslug || null,
        city,
        city_slug: city ? citySlug(city) : null,
        address: clean(cell("address")),
        lat: geoOk ? lat : null,
        lng: geoOk ? lng : null,
        tel: normTel(cell("tel")),
        corporation_name: corpName,
        corporation_slug: corpSlug,
        capacity,
        open_days: clean(cell("open_days")),
        official_url,
        acquired_on: opt.acquired,
        is_indexable: isIndexableFacility({ official_url, capacity }) ? 1 : 0,
      };

      if (records.has(id)) duplicated++;
      records.set(id, rec);
      fileRowCount++;
    }

    console.log(`  ${base}: ${fileRowCount.toLocaleString()}件  [種別: ${typeFromFile.name}]`);
  }

  const all = [...records.values()];
  console.log(`\n合計 ${all.length.toLocaleString()}件（ID重複で上書き ${duplicated}件 / ID・名称欠落でスキップ ${skippedNoId}件）`);

  // 充足率
  const pct = (n: number) => (all.length ? `${((n / all.length) * 100).toFixed(1)}%` : "-");
  const cov = {
    緯度経度: all.filter((f) => f.lat != null).length,
    市区町村: all.filter((f) => f.city).length,
    法人名: all.filter((f) => f.corporation_name).length,
    公式URL: all.filter((f) => f.official_url).length,
    定員: all.filter((f) => f.capacity != null).length,
    利用可能曜日: all.filter((f) => f.open_days).length,
    index対象: all.filter((f) => f.is_indexable === 1).length,
  };
  console.log("充足率:");
  for (const [k, v] of Object.entries(cov)) console.log(`  ${k}: ${pct(v)} (${v.toLocaleString()})`);

  if (unknownTypes.size > 0) {
    console.log(`\n[警告] 未知のサービス種別 ${unknownTypes.size}件（svc-<hash> のスラッグを自動採番しました）:`);
    for (const t of unknownTypes) console.log(`  - ${t}  → lib/serviceTypes.ts に追記推奨`);
  }
  if (warnings.length > 0) {
    console.log(`\n[警告] ${warnings.length}件:`);
    for (const w of warnings.slice(0, 50)) console.log(`  - ${w}`);
    if (warnings.length > 50) console.log(`  … 他 ${warnings.length - 50}件`);
  }

  if (opt.dryRun) {
    console.log("\n--dry-run のため出力しません。");
    return;
  }

  // 集計テーブル
  const corpAgg = new Map<string, { name: string; n: number; prefs: Set<string> }>();
  const areaAgg = new Map<string, { pref_slug: string; prefecture: string; city_slug: string; city: string; n: number }>();
  for (const f of all) {
    if (f.corporation_slug && f.corporation_name) {
      const c = corpAgg.get(f.corporation_slug) ?? { name: f.corporation_name, n: 0, prefs: new Set<string>() };
      c.n += 1;
      if (f.pref_slug) c.prefs.add(f.pref_slug);
      corpAgg.set(f.corporation_slug, c);
    }
    if (f.pref_slug && f.city_slug && f.prefecture && f.city) {
      const key = `${f.pref_slug}/${f.city_slug}`;
      const a = areaAgg.get(key) ?? {
        pref_slug: f.pref_slug, prefecture: f.prefecture, city_slug: f.city_slug, city: f.city, n: 0,
      };
      a.n += 1;
      areaAgg.set(key, a);
    }
  }

  const metaRows: Array<[string, string]> = [
    ["acquired_on", opt.acquired],
    ["source_name", "厚生労働省 介護サービス情報公表システム"],
    ["source_url", "https://www.mhlw.go.jp/stf/kaigo-kouhyou.html"],
    ["license", "CC BY 4.0"],
    ["imported_at", new Date().toISOString().slice(0, 19).replace("T", " ")],
    ["facility_total", String(all.length)],
  ];

  // ---- SQLite（開発用） ----
  const outPath = path.resolve(root, opt.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (fs.existsSync(outPath)) fs.rmSync(outPath);
  const db = new Database(outPath);
  db.exec(fs.readFileSync(path.resolve(root, "schema.sql"), "utf8"));

  const insFacility = db.prepare(
    `INSERT OR REPLACE INTO facility
     (id,name,service_type,service_type_slug,is_residential,postal_code,prefecture,pref_slug,city,city_slug,address,lat,lng,tel,corporation_name,corporation_slug,capacity,open_days,official_url,acquired_on,is_indexable)
     VALUES (@id,@name,@service_type,@service_type_slug,@is_residential,@postal_code,@prefecture,@pref_slug,@city,@city_slug,@address,@lat,@lng,@tel,@corporation_name,@corporation_slug,@capacity,@open_days,@official_url,@acquired_on,@is_indexable)`,
  );
  const insCorp = db.prepare("INSERT OR REPLACE INTO corporation (slug,name,facility_count,pref_count) VALUES (?,?,?,?)");
  const insArea = db.prepare("INSERT OR REPLACE INTO area (pref_slug,prefecture,city_slug,city,facility_count) VALUES (?,?,?,?,?)");
  const insMeta = db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)");

  db.transaction(() => {
    for (const f of all) insFacility.run(f);
    for (const [slug, c] of corpAgg) insCorp.run(slug, c.name, c.n, c.prefs.size);
    for (const a of areaAgg.values()) insArea.run(a.pref_slug, a.prefecture, a.city_slug, a.city, a.n);
    for (const [k, v] of metaRows) insMeta.run(k, v);
  })();
  db.close();
  console.log(`\nSQLite を書き出しました: ${outPath}`);

  // ---- D1投入用SQL ----
  const sqlDir = path.resolve(root, opt.sqlDir);
  fs.rmSync(sqlDir, { recursive: true, force: true });
  fs.mkdirSync(sqlDir, { recursive: true });

  const q = (v: string | number | null): string => {
    if (v === null) return "NULL";
    if (typeof v === "number") return String(v);
    return `'${v.replace(/'/g, "''")}'`;
  };

  fs.copyFileSync(path.resolve(root, "schema.sql"), path.join(sqlDir, "000_schema.sql"));

  let part = 1;
  for (let i = 0; i < all.length; i += opt.chunk) {
    const slice = all.slice(i, i + opt.chunk);
    const values = slice
      .map((f) =>
        `(${[
          q(f.id), q(f.name), q(f.service_type), q(f.service_type_slug), f.is_residential,
          q(f.postal_code), q(f.prefecture), q(f.pref_slug), q(f.city), q(f.city_slug), q(f.address),
          f.lat ?? "NULL", f.lng ?? "NULL", q(f.tel), q(f.corporation_name), q(f.corporation_slug),
          f.capacity ?? "NULL", q(f.open_days), q(f.official_url), q(f.acquired_on), f.is_indexable,
        ].join(",")})`,
      )
      .join(",\n");
    const sql =
      "INSERT OR REPLACE INTO facility (id,name,service_type,service_type_slug,is_residential,postal_code,prefecture,pref_slug,city,city_slug,address,lat,lng,tel,corporation_name,corporation_slug,capacity,open_days,official_url,acquired_on,is_indexable) VALUES\n" +
      values +
      ";\n";
    fs.writeFileSync(path.join(sqlDir, `${String(part).padStart(3, "0")}_facility.sql`), sql);
    part++;
  }

  const tail: string[] = [];
  for (const [slug, c] of corpAgg) {
    tail.push(`INSERT OR REPLACE INTO corporation (slug,name,facility_count,pref_count) VALUES (${q(slug)},${q(c.name)},${c.n},${c.prefs.size});`);
  }
  for (const a of areaAgg.values()) {
    tail.push(`INSERT OR REPLACE INTO area (pref_slug,prefecture,city_slug,city,facility_count) VALUES (${q(a.pref_slug)},${q(a.prefecture)},${q(a.city_slug)},${q(a.city)},${a.n});`);
  }
  for (const [k, v] of metaRows) tail.push(`INSERT OR REPLACE INTO meta (key,value) VALUES (${q(k)},${q(v)});`);
  fs.writeFileSync(path.join(sqlDir, `${String(part).padStart(3, "0")}_aggregates.sql`), tail.join("\n") + "\n");

  console.log(`D1投入用SQL を書き出しました: ${sqlDir} (${part}ファイル)`);
  console.log("\n次の手順:");
  console.log("  1) wrangler d1 create kaigo-db   → 出力された database_id を wrangler.jsonc に貼る");
  console.log(`  2) for f in ${opt.sqlDir}/*.sql; do npx wrangler d1 execute kaigo-db --remote --file="$f" --yes; done`);
}

main();
