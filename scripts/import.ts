/**
 * 厚労省「介護サービス情報公表システム」オープンデータCSV → SQLite / D1投入用SQL
 *
 * 使い方:
 *   npm run import -- <CSVディレクトリ> [options]
 *
 * 例:
 *   npm run import -- ./raw/20260929 --acquired 2026-09-29
 *   npm run import -- ./raw/20260929 --acquired 2026-09-29 --dry-run   # 出力せず列マッピングだけ確認
 *
 * options:
 *   --acquired YYYY-MM-DD  データ取得日（必須。meta.acquired_on に入り、全ページの出典表示に使う）
 *   --out PATH             SQLiteの出力先 (default: data/kaigo.sqlite)
 *   --sql-dir PATH         D1投入用SQLの出力先 (default: data/d1)
 *   --header-row N         ヘッダー行の行番号 (default: 1)
 *   --chunk N              1つのSQLファイルに入れる行数 (default: 2000)
 *   --dry-run              解析だけ行い、出力しない
 *
 * 方針:
 *   - 欠損は NULL のまま入れる（0や空文字で埋めない／推測しない）
 *   - 列名は COLUMN_MAP / IGNORED_COLUMNS で全列を明示的に扱う。
 *     どちらにも無い列は「未マッピング」として警告する（= --dry-run で0件になるのが正常）
 *   - 法人の名寄せキーは法人名ではなく法人番号（13桁）
 */

import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import Database from "better-sqlite3";
import {
  citySlug,
  corpSlugFromNumber,
  normalizeCorporateNumber,
  normalizeCorpName,
  placeKey,
  prefSlug,
} from "../lib/slug";
import { resolveServiceType } from "../lib/serviceTypes";
import { isIndexableFacility } from "../lib/indexing";
import { isValidJapanLatLng } from "../lib/geo";

// ---------------------------------------------------------------------------
// 列名マッピング（2026-09-29 取得の実CSV 24列で確定）
//   キー = 取り込み時の項目名、値 = CSVヘッダー名の候補（完全一致・上から優先）
//   部分一致は使わない（「事業所番号」が「事業所番号枝番」を拾うような事故を避けるため）。
// ---------------------------------------------------------------------------
const COLUMN_MAP: Record<string, string[]> = {
  // 実データの列名                        // 過去/将来の表記ゆれ候補
  jigyosho_no: ["事業所番号", "事業所番号（10桁）", "事業所番号(10桁)", "介護事業所番号"],
  name: ["事業所名", "事業所の名称", "事業所名称", "名称", "施設名"],
  prefecture: ["都道府県名", "都道府県", "事業所の所在地（都道府県）"],
  city: ["市区町村名", "市区町村", "事業所の所在地（市区町村）", "市町村"],
  address: ["住所", "所在地", "事業所の所在地", "事業所所在地"],
  address_sub: ["方書（ビル名等）", "方書(ビル名等)", "方書", "建物名"],
  lat: ["緯度", "事業所の緯度", "緯度（世界測地系）"],
  lng: ["経度", "事業所の経度", "経度（世界測地系）"],
  tel: ["電話番号", "事業所の電話番号", "TEL"],
  corporate_number: ["法人番号", "法人番号（13桁）", "法人番号(13桁)"],
  corporation_name: ["法人の名称", "法人名", "運営法人名", "法人等の名称"],
  capacity: ["定員", "利用定員", "入所定員", "定員（人）", "入居定員"],
  open_days: ["利用可能曜日", "営業日", "サービス提供曜日"],
  official_url: ["URL", "ＵＲＬ", "公式URL", "ホームページアドレス", "ホームページ"],
  service_type: ["サービスの種類", "サービス種別", "サービス種類", "サービス名"],
  // 出典CSVには無い（列があれば拾う）
  postal_code: ["郵便番号", "所在地（郵便番号）"],
};

/**
 * 意図的に取り込まない列。理由を書いてから足すこと。
 * ここに無い・COLUMN_MAP にも無い列は「未マッピング」として警告する。
 */
const IGNORED_COLUMNS: Array<{ name: string; reason: string }> = [
  { name: "都道府県コード又は市町村コード", reason: "市区町村スラッグは日本語名で作るため未使用（将来ローマ字化する際の材料）" },
  { name: "No", reason: "実データでは全行が事業所番号と同値だったため冗長" },
  { name: "事業所名カナ", reason: "表示にも検索にも使っていない" },
  { name: "FAX番号", reason: "掲載しない（利用者が使う導線ではない）" },
  { name: "利用可能曜日特記事項", reason: "入居系4種別では出典が全行空" },
  { name: "高齢者の方と障害者の方が同時一体的に利用できるサービス", reason: "共生型サービスのフラグ。入居系4種別では出典が全行空" },
  { name: "介護保険の通常の指定基準を満たしている", reason: "同上（全行空）" },
  { name: "障害福祉の通常の指定基準を満たしている", reason: "同上（全行空）" },
  { name: "備考", reason: "自由記述。出典どおりの掲載ができないため使わない" },
];

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
    .replace(/[‐－―−]/g, "-");

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
  return null; // 「準備中」やメールアドレスは URL として扱わない
}

/** 定員。出典は空欄と 0 が混在する（0は「未記入」の意味で使われている）ので0以下はNULL。 */
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

/**
 * 住所を1本に整える。
 *  1) 「方書（ビル名等）」が「住所」に含まれていなければ末尾に足す
 *     （実データ2,642件はすべて既に含まれていたため、実際には足されない）
 *  2) 都道府県・市区町村が抜けている行に前置して、全行を同じ粒度に揃える
 *     （出典の「住所」は都道府県から始まる行と市区町村から始まる行が混在している）
 */
function buildAddress(
  raw: string | null,
  sub: string | null,
  prefecture: string | null,
  city: string | null,
): { address: string | null; joinedSub: boolean } {
  if (!raw) return { address: null, joinedSub: false };
  let a = raw;
  let joinedSub = false;
  if (sub && !a.includes(sub)) { a += sub; joinedSub = true; }

  if (city && !a.includes(city)) {
    // 政令市の区名だけで始まる住所（「中央区南8条…」）に市名を二重に付けない
    const m = city.match(/^(.+?市)(.+区)$/);
    if (m && a.startsWith(m[2])) {
      a = m[1] + a;
    } else if (prefecture && a.startsWith(prefecture)) {
      a = prefecture + city + a.slice(prefecture.length);
    } else {
      a = city + a;
    }
  }
  if (prefecture && !a.startsWith(prefecture)) a = prefecture + a;
  return { address: a, joinedSub };
}

/**
 * 住所から町名（丁目・番地の手前まで）を切り出す。place テーブルの町名エントリに使う。
 * 数字が出た時点で打ち切る単純な規則なので、「南13条西13丁目」は「南」までしか取れない。
 * 精度より「検索の起点として妥当な代表点が作れるか」を優先している。
 */
function extractTown(address: string, prefecture: string | null, city: string | null): string {
  let a = placeKey(address);
  if (prefecture && a.startsWith(placeKey(prefecture))) a = a.slice(placeKey(prefecture).length);
  const ck = city ? placeKey(city) : "";
  if (ck) {
    if (a.startsWith(ck)) a = a.slice(ck.length);
    else {
      const i = a.indexOf(ck);
      if (i >= 0) a = a.slice(i + ck.length);
    }
  }
  const m = a.match(/[0-9]/);
  if (m && m.index !== undefined) a = a.slice(0, m.index);
  return a.replace(/[丁目大字字]+$/, "");
}

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

interface FacilityRecord {
  id: string;
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
  corporate_number: string | null;
  corporation_name: string | null;
  corporation_slug: string | null;
  capacity: number | null;
  open_days: string | null;
  official_url: string | null;
  acquired_on: string;
  is_indexable: number;
}

/** 集計の前に一度だけ持つ中間表現 */
interface RawRow extends Omit<FacilityRecord, "id" | "corporation_name" | "corporation_slug"> {
  /** 出典どおりの法人名（表示名の多数決に使う） */
  corporation_name_raw: string | null;
  /** place の町名エントリ用 */
  town: string;
}

function buildHeaderIndex(header: string[]): { map: Record<string, number>; unmapped: string[] } {
  const key = (h: string) => h.replace(/[\s　]/g, "").replace(/^"|"$/g, "");
  const norm = header.map(key);
  const map: Record<string, number> = {};
  const used = new Set<number>();

  for (const [field, candidates] of Object.entries(COLUMN_MAP)) {
    for (const cand of candidates) {
      const c = key(cand);
      const idx = norm.findIndex((h, i) => !used.has(i) && h === c);
      if (idx >= 0) { map[field] = idx; used.add(idx); break; }
    }
  }

  const ignored = new Set(IGNORED_COLUMNS.map((c) => key(c.name)));
  const unmapped = norm.filter((h, i) => h !== "" && !used.has(i) && !ignored.has(h));
  return { map, unmapped };
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

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
  console.log(`CSV ${files.length}本を読み込みます (${dir})\n`);

  const raws: RawRow[] = [];
  const warnings: string[] = [];
  const unknownTypes = new Set<string>();
  const unknownPrefs = new Set<string>();
  let skippedNoId = 0;
  let joinedSubCount = 0;
  // 名寄せの前後比較用
  const rawCorpNames = new Set<string>();
  const rawCorpNamesWithNumber = new Set<string>();

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

    let missingRequired = false;
    for (const req of ["jigyosho_no", "name"]) {
      if (map[req] === undefined) {
        warnings.push(`${base}: 必須列「${req}」に対応するヘッダーが見つかりません → このファイルはスキップ`);
        missingRequired = true;
      }
    }
    if (missingRequired) continue;
    if (unmapped.length > 0) {
      warnings.push(
        `${base}: 未マッピングの列 ${unmapped.length}件 → ${unmapped.join(" / ")}` +
          "（COLUMN_MAP か IGNORED_COLUMNS に追記してください）",
      );
    }

    const typeFromFile = resolveServiceType(base.replace(/\.csv$/i, ""));
    let fileRowCount = 0;

    for (const r of body) {
      const cell = (field: string): string | undefined => {
        const i = map[field];
        return i === undefined ? undefined : r[i];
      };

      const no = clean(cell("jigyosho_no"))?.replace(/\s/g, "");
      const name = clean(cell("name"));
      if (!no || !name) { skippedNoId++; continue; }

      const rawType = clean(cell("service_type"));
      const st = rawType ? resolveServiceType(rawType) : typeFromFile;
      if (!st.known) unknownTypes.add(st.name);

      const prefecture = clean(cell("prefecture"));
      const city = clean(cell("city"));
      const pslug = prefSlug(prefecture);
      if (prefecture && !pslug) unknownPrefs.add(prefecture);

      const lat = normFloat(cell("lat"));
      const lng = normFloat(cell("lng"));
      const geoOk = isValidJapanLatLng(lat, lng);

      const { address, joinedSub } = buildAddress(
        clean(cell("address")),
        clean(cell("address_sub")),
        prefecture,
        city,
      );
      if (joinedSub) joinedSubCount++;

      const corpNameRaw = clean(cell("corporation_name"));
      const corpNo = normalizeCorporateNumber(cell("corporate_number"));
      if (corpNameRaw) {
        rawCorpNames.add(corpNameRaw);
        if (corpNo) rawCorpNamesWithNumber.add(corpNameRaw);
      }

      const capacity = normInt(cell("capacity"));
      const official_url = normUrl(cell("official_url"));

      raws.push({
        jigyosho_no: no,
        name,
        service_type: st.name,
        service_type_slug: st.slug,
        is_residential: st.residential ? 1 : 0,
        postal_code: normPostal(cell("postal_code")),
        prefecture,
        pref_slug: pslug || null,
        city,
        city_slug: city ? citySlug(city) : null,
        address,
        lat: geoOk ? lat : null,
        lng: geoOk ? lng : null,
        tel: normTel(cell("tel")),
        corporate_number: corpNo || null,
        corporation_name_raw: corpNameRaw,
        capacity,
        open_days: clean(cell("open_days")),
        official_url,
        acquired_on: opt.acquired,
        is_indexable: isIndexableFacility({ official_url, capacity }) ? 1 : 0,
        town: address ? extractTown(address, prefecture, city) : "",
      });
      fileRowCount++;
    }

    console.log(`  ${base}: ${fileRowCount.toLocaleString()}件  [種別: ${typeFromFile.name}]`);
  }

  // -------------------------------------------------------------------------
  // 法人の名寄せ（キー = 法人番号13桁）
  //   表示名は「同一法人番号の中で最も多く出現した表記」。
  //   比較時は空白を除去して正規化し、同数なら文字列昇順で固定する（再実行しても同じ結果にする）。
  // -------------------------------------------------------------------------
  const corpNameVotes = new Map<string, Map<string, number>>();
  for (const r of raws) {
    if (!r.corporate_number || !r.corporation_name_raw) continue;
    const votes = corpNameVotes.get(r.corporate_number) ?? new Map<string, number>();
    const k = normalizeCorpName(r.corporation_name_raw);
    votes.set(k, (votes.get(k) ?? 0) + 1);
    corpNameVotes.set(r.corporate_number, votes);
  }
  const corpDisplayName = new Map<string, string>();
  for (const [no, votes] of corpNameVotes) {
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))[0];
    corpDisplayName.set(no, best[0]);
  }

  // -------------------------------------------------------------------------
  // 複合IDの確定
  //   事業所番号は全国一意ではない（併設事業所が同じ番号を持つ）ので
  //   「事業所番号-サービス種別スラッグ」を使い、それでも重なる分だけ連番を足す。
  //   連番は事業所名+住所の昇順で決めるので、再実行しても同じIDになる。
  // -------------------------------------------------------------------------
  const byBase = new Map<string, RawRow[]>();
  for (const r of raws) {
    const b = `${r.jigyosho_no}-${r.service_type_slug}`;
    const list = byBase.get(b) ?? [];
    list.push(r);
    byBase.set(b, list);
  }

  const all: FacilityRecord[] = [];
  let suffixed = 0;
  for (const [b, list] of byBase) {
    const sorted = list.length > 1
      ? [...list].sort((x, y) => x.name.localeCompare(y.name, "ja") || (x.address ?? "").localeCompare(y.address ?? "", "ja"))
      : list;
    sorted.forEach((r, i) => {
      if (i > 0) suffixed++;
      const corpNo = r.corporate_number;
      const displayName = corpNo ? corpDisplayName.get(corpNo) ?? r.corporation_name_raw : r.corporation_name_raw;
      all.push({
        id: i === 0 ? b : `${b}-${i + 1}`,
        jigyosho_no: r.jigyosho_no,
        name: r.name,
        service_type: r.service_type,
        service_type_slug: r.service_type_slug,
        is_residential: r.is_residential,
        postal_code: r.postal_code,
        prefecture: r.prefecture,
        pref_slug: r.pref_slug,
        city: r.city,
        city_slug: r.city_slug,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        tel: r.tel,
        corporate_number: corpNo,
        corporation_name: displayName,
        // 法人番号が無い事業所は法人ページを作らない（施設ページには法人名をそのまま出す）
        corporation_slug: corpNo ? corpSlugFromNumber(corpNo) : null,
        capacity: r.capacity,
        open_days: r.open_days,
        official_url: r.official_url,
        acquired_on: r.acquired_on,
        is_indexable: r.is_indexable,
      });
    });
  }
  all.sort((a, b) => a.id.localeCompare(b.id));

  // -------------------------------------------------------------------------
  // 集計
  // -------------------------------------------------------------------------
  const corpAgg = new Map<string, { no: string; name: string; n: number; prefs: Set<string>; variants: number }>();
  const areaAgg = new Map<string, { pref_slug: string; prefecture: string; city_slug: string; city: string; n: number }>();
  for (const f of all) {
    if (f.corporation_slug && f.corporate_number && f.corporation_name) {
      const c = corpAgg.get(f.corporation_slug) ?? {
        no: f.corporate_number,
        name: f.corporation_name,
        n: 0,
        prefs: new Set<string>(),
        variants: corpNameVotes.get(f.corporate_number)?.size ?? 1,
      };
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

  // ---- place（住所・地名 → 代表点）----
  // 緯度経度が入っている行だけを使い、都道府県／市区町村／町名それぞれで平均座標を取る。
  interface PlaceAcc {
    name: string;
    kind: "pref" | "city" | "town";
    pref_slug: string | null;
    city_slug: string | null;
    sumLat: number;
    sumLng: number;
    n: number;
  }
  const placeAcc = new Map<string, PlaceAcc>();
  const add = (
    key: string,
    name: string,
    kind: PlaceAcc["kind"],
    pref_slug: string | null,
    city_slug: string | null,
    lat: number,
    lng: number,
  ) => {
    if (!key) return;
    const a = placeAcc.get(key) ?? { name, kind, pref_slug, city_slug, sumLat: 0, sumLng: 0, n: 0 };
    a.sumLat += lat; a.sumLng += lng; a.n += 1;
    placeAcc.set(key, a);
  };

  // 市区町村名・町名の全国一意性を先に調べる（一意なものだけ「短いキー」も登録する）
  const cityToPrefs = new Map<string, Set<string>>();
  const townToPlaces = new Map<string, Set<string>>();
  for (const f of all) {
    if (f.city && f.prefecture) {
      const s = cityToPrefs.get(f.city) ?? new Set<string>();
      s.add(f.prefecture);
      cityToPrefs.set(f.city, s);
    }
  }
  for (const r of raws) {
    if (!r.address) continue;
    const t = extractTown(r.address, r.prefecture, r.city);
    if (t.length < 2) continue;
    const s = townToPlaces.get(t) ?? new Set<string>();
    s.add(`${r.prefecture ?? ""}/${r.city ?? ""}`);
    townToPlaces.set(t, s);
  }

  for (const f of all) {
    if (f.lat == null || f.lng == null) continue;
    if (f.prefecture) {
      add(placeKey(f.prefecture), f.prefecture, "pref", f.pref_slug, null, f.lat, f.lng);
      // 「東京都」→「東京」の短縮形も引けるようにする
      const short = f.prefecture.replace(/[都府県]$/, "");
      if (short !== f.prefecture) add(placeKey(short), f.prefecture, "pref", f.pref_slug, null, f.lat, f.lng);
    }
    if (f.prefecture && f.city) {
      add(placeKey(f.prefecture + f.city), f.prefecture + f.city, "city", f.pref_slug, f.city_slug, f.lat, f.lng);
      // 市区町村名だけのキーは、全国で一意なときにだけ登録する（「中央区」は多数あるため登録しない）
      if ((cityToPrefs.get(f.city)?.size ?? 0) === 1) {
        add(placeKey(f.city), f.prefecture + f.city, "city", f.pref_slug, f.city_slug, f.lat, f.lng);
      }
    }
  }
  for (let i = 0; i < raws.length; i++) {
    const r = raws[i];
    if (r.lat == null || r.lng == null || !r.address) continue;
    const t = extractTown(r.address, r.prefecture, r.city);
    if (t.length < 2 || !r.prefecture || !r.city) continue;
    const full = r.prefecture + r.city + t;
    add(placeKey(full), full, "town", r.pref_slug, r.city_slug, r.lat, r.lng);
    add(placeKey(r.city + t), full, "town", r.pref_slug, r.city_slug, r.lat, r.lng);
    if ((townToPlaces.get(t)?.size ?? 0) === 1) {
      add(placeKey(t), full, "town", r.pref_slug, r.city_slug, r.lat, r.lng);
    }
  }

  const places = [...placeAcc.entries()]
    .map(([key, a]) => ({
      key,
      name: a.name,
      kind: a.kind,
      pref_slug: a.pref_slug,
      city_slug: a.city_slug,
      lat: a.sumLat / a.n,
      lng: a.sumLng / a.n,
      facility_count: a.n,
    }))
    .sort((x, y) => x.key.localeCompare(y.key));

  // -------------------------------------------------------------------------
  // レポート
  // -------------------------------------------------------------------------
  const pct = (n: number) => (all.length ? `${((n / all.length) * 100).toFixed(1)}%` : "-");
  const caps = all.map((f) => f.capacity).filter((c): c is number => c != null).sort((a, b) => a - b);
  const median = caps.length
    ? caps.length % 2 ? caps[(caps.length - 1) / 2] : (caps[caps.length / 2 - 1] + caps[caps.length / 2]) / 2
    : null;
  const area3plus = [...areaAgg.values()].filter((a) => a.n >= 3).length;

  console.log(`\n合計 ${all.length.toLocaleString()}件（ID重複で連番を付した行 ${suffixed}件 / 事業所番号・名称の欠落でスキップ ${skippedNoId}件）`);
  console.log(`方書を住所に連結した行: ${joinedSubCount.toLocaleString()}件（住所に既に含まれていた行は連結しない）`);

  console.log("\n種別ごと件数:");
  const typeCount = new Map<string, number>();
  for (const f of all) typeCount.set(f.service_type, (typeCount.get(f.service_type) ?? 0) + 1);
  for (const [k, v] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v.toLocaleString()}`);
  }

  console.log("\n名寄せ:");
  console.log(`  法人数（法人番号ベース）: ${corpAgg.size.toLocaleString()}`);
  console.log(`  参考・法人名ベースだった場合（法人番号のある行のみ）: ${rawCorpNamesWithNumber.size.toLocaleString()}`);
  console.log(`  参考・法人名ベースだった場合（全行）: ${rawCorpNames.size.toLocaleString()}`);
  console.log(`  表記ゆれを吸収した法人: ${[...corpAgg.values()].filter((c) => c.variants > 1).length.toLocaleString()}`);
  console.log(`  法人番号が無く法人ページを作らない事業所: ${all.filter((f) => !f.corporate_number).length.toLocaleString()}`);

  console.log("\nエリア・地名:");
  console.log(`  市区町村数: ${areaAgg.size.toLocaleString()}`);
  console.log(`  3件以上ある市区町村数: ${area3plus.toLocaleString()}`);
  console.log(`  place（住所検索辞書）: ${places.length.toLocaleString()}件`);

  console.log(`\n定員の中央値（記載のある${caps.length.toLocaleString()}件）: ${median ?? "-"}`);

  const cov: Array<[string, number]> = [
    ["事業所名", all.filter((f) => f.name).length],
    ["住所", all.filter((f) => f.address).length],
    ["都道府県", all.filter((f) => f.prefecture).length],
    ["市区町村", all.filter((f) => f.city).length],
    ["緯度経度", all.filter((f) => f.lat != null).length],
    ["電話番号", all.filter((f) => f.tel).length],
    ["法人番号", all.filter((f) => f.corporate_number).length],
    ["法人名", all.filter((f) => f.corporation_name).length],
    ["定員(1以上)", all.filter((f) => f.capacity != null).length],
    ["利用可能曜日", all.filter((f) => f.open_days).length],
    ["公式URL", all.filter((f) => f.official_url).length],
    ["郵便番号", all.filter((f) => f.postal_code).length],
    ["index対象", all.filter((f) => f.is_indexable === 1).length],
  ];
  console.log("\n充足率:");
  for (const [k, v] of cov) console.log(`  ${k}: ${pct(v)} (${v.toLocaleString()})`);

  if (unknownTypes.size > 0) {
    console.log(`\n[警告] 未知のサービス種別 ${unknownTypes.size}件:`);
    for (const t of unknownTypes) console.log(`  - ${t}  → lib/serviceTypes.ts に追記してください`);
  } else {
    console.log("\n未知のサービス種別: 0件");
  }
  if (unknownPrefs.size > 0) {
    console.log(`[警告] 未知の都道府県表記 ${unknownPrefs.size}件: ${[...unknownPrefs].join(" / ")}`);
  } else {
    console.log("未知の都道府県表記: 0件");
  }
  if (warnings.length > 0) {
    console.log(`\n[警告] ${warnings.length}件:`);
    for (const w of warnings.slice(0, 50)) console.log(`  - ${w}`);
    if (warnings.length > 50) console.log(`  … 他 ${warnings.length - 50}件`);
  } else {
    console.log("未マッピングの列: 0件");
  }

  if (opt.dryRun) {
    console.log("\n--dry-run のため出力しません。");
    return;
  }

  const metaRows: Array<[string, string]> = [
    ["acquired_on", opt.acquired],
    ["source_name", "厚生労働省 介護サービス情報公表システム"],
    ["source_url", "https://www.mhlw.go.jp/stf/kaigo-kouhyou.html"],
    ["license", "CC BY 4.0"],
    ["imported_at", new Date().toISOString().slice(0, 19).replace("T", " ")],
    ["facility_total", String(all.length)],
    ["corporation_total", String(corpAgg.size)],
    ["area_total", String(areaAgg.size)],
    ["area_total_3plus", String(area3plus)],
    ["capacity_median", median == null ? "" : String(median)],
    // トップページ・/data/ に出す充足率の分子（分母は facility_total）。
    // 画面側で割って表示する＝ハードコードした割合をどこにも書かないため。
    ["cov_latlng", String(all.filter((f) => f.lat != null).length)],
    ["cov_capacity", String(all.filter((f) => f.capacity != null).length)],
    ["cov_url", String(all.filter((f) => f.official_url).length)],
    ["cov_corporate_number", String(all.filter((f) => f.corporate_number).length)],
  ];

  // ---- SQLite（開発用） ----
  const outPath = path.resolve(root, opt.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (fs.existsSync(outPath)) fs.rmSync(outPath);
  const db = new Database(outPath);
  db.exec(fs.readFileSync(path.resolve(root, "schema.sql"), "utf8"));

  const FACILITY_INSERT_COLS =
    "id,jigyosho_no,name,service_type,service_type_slug,is_residential,postal_code,prefecture,pref_slug,city,city_slug,address,lat,lng,tel,corporate_number,corporation_name,corporation_slug,capacity,open_days,official_url,acquired_on,is_indexable";

  const insFacility = db.prepare(
    `INSERT OR REPLACE INTO facility (${FACILITY_INSERT_COLS})
     VALUES (@id,@jigyosho_no,@name,@service_type,@service_type_slug,@is_residential,@postal_code,@prefecture,@pref_slug,@city,@city_slug,@address,@lat,@lng,@tel,@corporate_number,@corporation_name,@corporation_slug,@capacity,@open_days,@official_url,@acquired_on,@is_indexable)`,
  );
  const insCorp = db.prepare(
    "INSERT OR REPLACE INTO corporation (slug,corporate_number,name,facility_count,pref_count,name_variants) VALUES (?,?,?,?,?,?)",
  );
  const insArea = db.prepare("INSERT OR REPLACE INTO area (pref_slug,prefecture,city_slug,city,facility_count) VALUES (?,?,?,?,?)");
  const insPlace = db.prepare(
    "INSERT OR REPLACE INTO place (key,name,kind,pref_slug,city_slug,lat,lng,facility_count) VALUES (?,?,?,?,?,?,?,?)",
  );
  const insMeta = db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)");

  db.transaction(() => {
    for (const f of all) insFacility.run(f);
    for (const [slug, c] of corpAgg) insCorp.run(slug, c.no, c.name, c.n, c.prefs.size, c.variants);
    for (const a of areaAgg.values()) insArea.run(a.pref_slug, a.prefecture, a.city_slug, a.city, a.n);
    for (const p of places) insPlace.run(p.key, p.name, p.kind, p.pref_slug, p.city_slug, p.lat, p.lng, p.facility_count);
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
  const writeChunks = (name: string, rows: string[]) => {
    for (let i = 0; i < rows.length; i += opt.chunk) {
      const slice = rows.slice(i, i + opt.chunk);
      fs.writeFileSync(
        path.join(sqlDir, `${String(part).padStart(3, "0")}_${name}.sql`),
        slice.join("\n") + "\n",
      );
      part++;
    }
  };

  writeChunks(
    "facility",
    all.map(
      (f) =>
        `INSERT OR REPLACE INTO facility (${FACILITY_INSERT_COLS}) VALUES (${[
          q(f.id), q(f.jigyosho_no), q(f.name), q(f.service_type), q(f.service_type_slug), f.is_residential,
          q(f.postal_code), q(f.prefecture), q(f.pref_slug), q(f.city), q(f.city_slug), q(f.address),
          f.lat ?? "NULL", f.lng ?? "NULL", q(f.tel), q(f.corporate_number), q(f.corporation_name), q(f.corporation_slug),
          f.capacity ?? "NULL", q(f.open_days), q(f.official_url), q(f.acquired_on), f.is_indexable,
        ].join(",")});`,
    ),
  );

  writeChunks(
    "corporation",
    [...corpAgg.entries()].map(
      ([slug, c]) =>
        `INSERT OR REPLACE INTO corporation (slug,corporate_number,name,facility_count,pref_count,name_variants) VALUES (${q(slug)},${q(c.no)},${q(c.name)},${c.n},${c.prefs.size},${c.variants});`,
    ),
  );

  writeChunks(
    "place",
    places.map(
      (p) =>
        `INSERT OR REPLACE INTO place (key,name,kind,pref_slug,city_slug,lat,lng,facility_count) VALUES (${q(p.key)},${q(p.name)},${q(p.kind)},${q(p.pref_slug)},${q(p.city_slug)},${p.lat},${p.lng},${p.facility_count});`,
    ),
  );

  const tail: string[] = [];
  for (const a of areaAgg.values()) {
    tail.push(`INSERT OR REPLACE INTO area (pref_slug,prefecture,city_slug,city,facility_count) VALUES (${q(a.pref_slug)},${q(a.prefecture)},${q(a.city_slug)},${q(a.city)},${a.n});`);
  }
  for (const [k, v] of metaRows) tail.push(`INSERT OR REPLACE INTO meta (key,value) VALUES (${q(k)},${q(v)});`);
  writeChunks("area_meta", tail);

  console.log(`D1投入用SQL を書き出しました: ${sqlDir} (${part}ファイル)`);
  console.log("\n次の手順:");
  console.log("  1) wrangler d1 create kaigo-db   → 出力された database_id を wrangler.jsonc に貼る");
  console.log(`  2) for f in ${opt.sqlDir}/*.sql; do npx wrangler d1 execute kaigo-db --remote --file="$f" --yes; done`);
}

main();
