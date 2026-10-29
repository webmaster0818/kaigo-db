/**
 * トップの住所・地名入力の候補（住所オートコンプリート）用の静的な索引を作る。
 *
 *   npx tsx scripts/gen-addr-index.ts            # data/kaigo.sqlite から作る
 *
 * 目的：入力のたびに D1 を読まないこと（/?q= の D1 読み取りは本番の上限に効いている）。
 * 候補はすべてビルド時に data/kaigo.sqlite（import.ts が作る。D1 に投入したものと同じデータ）から作り、
 * public/addr/ に静的ファイルとして置く。Workers の静的アセットは Worker より先に返されるので
 * （wrangler.jsonc に run_worker_first なし）、取得しても Worker・Next・D1 は動かない。
 *
 * 出力：
 *   public/addr/index.json      … 都道府県・市区町村（地名辞書 place の pref/city）。入力欄に触れたときに最初に読む
 *   public/addr/towns.json      … 町域名（place の town）を都道府県ごとに連結したもの。市区町村名が入っていない入力
 *                                  （例「成城」）で、どの都道府県の索引を読むかを決めるためだけに使う
 *   public/addr/p/<pref>.json   … 都道府県ごとの町域と住所（番地まで・同じ番地の施設数）
 *   lib/areaTopCities.generated.json … トップ「エリアから探す」タブの、都道府県ごとの施設数上位の市区町村（コミットする）
 *
 * 住所は番地までで切り（建物名・階数を落とす）、照合キー（lib/addrNormalize.ts の looseKey）が同じものを1件にまとめる。
 * 座標は同じ番地の施設の平均。推測で作った住所・座標は入れない（掲載施設の住所だけ）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { cutToBanchi, looseKey, normalizeAddr } from "../lib/addrNormalize";
import { PREF_ORDER, PREF_SLUGS } from "../lib/slug";

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data/kaigo.sqlite");
const OUT = path.join(ROOT, "public/addr");
const TOP_CITIES_OUT = path.join(ROOT, "lib/areaTopCities.generated.json");
const TOP_CITIES_N = 4;

if (!fs.existsSync(DB_PATH)) {
  console.error(`${DB_PATH} がありません。先に npm run import を実行してください。`);
  process.exit(1);
}
const db = new Database(DB_PATH, { readonly: true });

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

interface PlaceRow { name: string; kind: string; pref_slug: string | null; city_slug: string | null; lat: number; lng: number; facility_count: number }
const places = db.prepare("SELECT name, kind, pref_slug, city_slug, lat, lng, facility_count FROM place").all() as PlaceRow[];

const prefIdx = new Map<string, number>(); // pref_slug -> index
const prefs: Array<[string, string, number, number, number]> = []; // [名称, slug, lat, lng, 件数]
for (const name of PREF_ORDER) {
  const slug = PREF_SLUGS[name];
  const p = places.find((x) => x.kind === "pref" && x.pref_slug === slug);
  prefIdx.set(slug, prefs.length);
  prefs.push([name, slug, p ? r5(p.lat) : 0, p ? r5(p.lng) : 0, p?.facility_count ?? 0]);
}

// 市区町村：[都道府県index, 名称（都道府県名を除く）, lat, lng, 件数]
const cities: Array<[number, string, number, number, number]> = [];
const cityIdx = new Map<string, number>(); // `${pref}/${city_slug}` -> index
for (const p of places.filter((x) => x.kind === "city" && x.pref_slug).sort((a, b) => b.facility_count - a.facility_count)) {
  const pi = prefIdx.get(p.pref_slug!);
  if (pi == null || cityIdx.has(`${p.pref_slug}/${p.city_slug}`)) continue; // place は表記違いのキーで同じ市区町村を複数持つ
  const prefName = prefs[pi][0];
  const name = p.name.startsWith(prefName) ? p.name.slice(prefName.length) : p.name;
  cityIdx.set(`${p.pref_slug}/${p.city_slug}`, cities.length);
  cities.push([pi, name, r5(p.lat), r5(p.lng), p.facility_count]);
}

// 町域：都道府県ごとに [市区町村index, 町域名（市区町村名を除く）, lat, lng, 件数]
const towns = new Map<string, Array<[number, string, number, number, number]>>();
const seenTown = new Set<string>();
for (const p of places.filter((x) => x.kind === "town" && x.pref_slug)) {
  const ci = cityIdx.get(`${p.pref_slug}/${p.city_slug}`);
  if (ci == null) continue;
  const full = prefs[cities[ci][0]][0] + cities[ci][1];
  const name = p.name.startsWith(full) ? p.name.slice(full.length) : p.name;
  if (!name || seenTown.has(`${ci}/${name}`)) continue;
  seenTown.add(`${ci}/${name}`);
  if (!towns.has(p.pref_slug!)) towns.set(p.pref_slug!, []);
  towns.get(p.pref_slug!)!.push([ci, name, r5(p.lat), r5(p.lng), p.facility_count]);
}

// 地名辞書には「成城三」「成城八」のように、漢数字の丁目が町域名に混ざったものがある。
// 同じ市区町村に漢数字を外した町域（「成城」）があれば、候補としては重複なので外す
for (const [slug, list] of towns) {
  const names = new Set(list.map((t) => `${t[0]}/${t[1]}`));
  towns.set(
    slug,
    list.filter((t) => {
      const base = t[1].replace(/[一二三四五六七八九十]+$/, "");
      return base === t[1] || !names.has(`${t[0]}/${base}`);
    }),
  );
}

// 住所（番地まで）：都道府県ごとに [市区町村index, 住所（都道府県名を除く・番地まで）, lat, lng, 件数]
interface FRow { prefecture: string; pref_slug: string; city_slug: string; address: string; lat: number; lng: number }
const rows = db
  .prepare(
    `SELECT prefecture, pref_slug, city_slug, address, lat, lng FROM facility
     WHERE address IS NOT NULL AND address <> '' AND lat IS NOT NULL AND lng IS NOT NULL AND pref_slug IS NOT NULL AND pref_slug <> ''`,
  )
  .all() as FRow[];
const addrMap = new Map<string, Map<string, { ci: number; disp: Map<string, number>; lat: number; lng: number; n: number }>>();
let skipped = 0;
for (const f of rows) {
  const ci = cityIdx.get(`${f.pref_slug}/${f.city_slug}`);
  if (ci == null) { skipped++; continue; }
  let a = cutToBanchi(f.address);
  const pn = normalizeAddr(f.prefecture);
  if (a.startsWith(pn)) a = a.slice(pn.length);
  if (!/\d/.test(a)) { skipped++; continue; } // 番地の無い住所は町域の候補で足りる
  const key = looseKey(a);
  if (!addrMap.has(f.pref_slug)) addrMap.set(f.pref_slug, new Map());
  const m = addrMap.get(f.pref_slug)!;
  const cur = m.get(key);
  if (cur) {
    cur.lat += f.lat; cur.lng += f.lng; cur.n += 1;
    cur.disp.set(a, (cur.disp.get(a) ?? 0) + 1);
  } else {
    m.set(key, { ci, disp: new Map([[a, 1]]), lat: f.lat, lng: f.lng, n: 1 });
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "p"), { recursive: true });

const sizes: Record<string, number> = {};
const write = (rel: string, obj: unknown) => {
  const s = JSON.stringify(obj);
  fs.writeFileSync(path.join(OUT, rel), s);
  sizes[rel] = Buffer.byteLength(s);
  return s;
};

let addrCount = 0;
const hash = crypto.createHash("sha1");
for (const [slug] of prefs.map((p) => [p[1]])) {
  const m = addrMap.get(slug) ?? new Map();
  const addrs = [...m.values()]
    .map((v) => {
      const disp = [...v.disp.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return [v.ci, disp, r5(v.lat / v.n), r5(v.lng / v.n), v.n] as [number, string, number, number, number];
    })
    .sort((a, b) => b[4] - a[4] || a[1].localeCompare(b[1], "ja"));
  addrCount += addrs.length;
  const t = (towns.get(slug) ?? []).sort((a, b) => b[4] - a[4]);
  hash.update(write(`p/${slug}.json`, { t, a: addrs }));
}
// towns.json：都道府県ごとに町域名を「|」で連結（座標は持たない。都道府県の決定だけに使う）
const townNames: Record<string, string> = {};
for (const [slug, list] of towns) townNames[slug] = [...new Set(list.map((t) => t[1]))].join("|");
hash.update(write("towns.json", townNames));
// index.json の v は内容のハッシュ。ブラウザは ?v= を付けて各ファイルを読む（データ更新時に古いキャッシュを使わない）
const v = hash.digest("hex").slice(0, 10);
write("index.json", { v, prefs, cities });

// トップ「エリアから探す」タブ用：都道府県ごとの施設数上位の市区町村（area テーブルの実数）
const area = db
  .prepare("SELECT pref_slug, city, city_slug, facility_count FROM area WHERE pref_slug <> '' ORDER BY facility_count DESC, city")
  .all() as Array<{ pref_slug: string; city: string; city_slug: string; facility_count: number }>;
const topCities: Record<string, Array<{ city: string; city_slug: string }>> = {};
for (const a of area) {
  const list = (topCities[a.pref_slug] ??= []);
  if (list.length < TOP_CITIES_N) list.push({ city: a.city, city_slug: a.city_slug });
}
fs.writeFileSync(TOP_CITIES_OUT, JSON.stringify(topCities, null, 1) + "\n");

const total = Object.values(sizes).reduce((s, n) => s + n, 0);
const max = Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 3);
console.log(
  `addr index v=${v}: 都道府県${prefs.length}・市区町村${cities.length}・町域${[...towns.values()].reduce((s, l) => s + l.length, 0)}・住所${addrCount}件（除外${skipped}）`,
);
console.log(`合計 ${(total / 1024).toFixed(0)}KB（index ${(sizes["index.json"] / 1024).toFixed(0)}KB・towns ${(sizes["towns.json"] / 1024).toFixed(0)}KB）／大きい順: ${max.map(([k, n]) => `${k} ${(n / 1024).toFixed(0)}KB`).join("・")}`);
