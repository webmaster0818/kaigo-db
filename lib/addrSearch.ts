// 住所・地名の候補（ブラウザ側）。public/addr/ の静的な索引（scripts/gen-addr-index.ts が作る）を読み、手元で照合する。
// サーバー（Worker・Next・D1）には一切問い合わせない。索引は入力欄に触れたときに初めて読む。

import { looseKey, normalizeAddr } from "./addrNormalize";

type PrefRow = [name: string, slug: string, lat: number, lng: number, n: number];
type CityRow = [pref: number, name: string, lat: number, lng: number, n: number];
type EntryRow = [city: number, name: string, lat: number, lng: number, n: number];
interface Index { v: string; prefs: PrefRow[]; cities: CityRow[] }
interface PrefChunk { t: EntryRow[]; a: EntryRow[] }

export type CandidateKind = "pref" | "city" | "town" | "addr";
export interface Candidate {
  kind: CandidateKind;
  /** 表示名（都道府県から） */
  label: string;
  lat: number;
  lng: number;
  /** その地点の掲載施設数（住所は同じ番地の施設数、地名は区域内の施設数） */
  n: number;
}

let indexP: Promise<Index | null> | null = null;
let townsP: Promise<Record<string, string> | null> | null = null;
const chunks = new Map<string, Promise<PrefChunk | null>>();

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** 入力欄に触れたときに呼ぶ（索引の先読み） */
export function loadIndex(): Promise<Index | null> {
  // index.json は毎回の再検証（ETag）で新しさを確認し、他のファイルは index の v を付けて読む
  indexP ??= getJson<Index>("/addr/index.json");
  return indexP;
}
function loadTowns(v: string) {
  townsP ??= getJson<Record<string, string>>(`/addr/towns.json?v=${v}`);
  return townsP;
}
function loadChunk(slug: string, v: string) {
  if (!chunks.has(slug)) chunks.set(slug, getJson<PrefChunk>(`/addr/p/${slug}.json?v=${v}`));
  return chunks.get(slug)!;
}

// 照合キーは索引ごとに1回だけ作る（入力のたびに数千件を正規化しない）
const keyCache = new WeakMap<PrefChunk, string[]>();
function keysOf(c: PrefChunk): string[] {
  let k = keyCache.get(c);
  if (!k) {
    k = c.a.map((a) => looseKey(a[1]));
    keyCache.set(c, k);
  }
  return k;
}

const shortPref = (name: string) => (name === "北海道" ? name : name.replace(/[都府県]$/, ""));

export async function searchCandidates(input: string, limit = 10): Promise<Candidate[]> {
  const q = normalizeAddr(input);
  if (!q) return [];
  const idx = await loadIndex();
  if (!idx) return [];
  const { prefs, cities, v } = idx;

  // 都道府県名（「東京都」「東京」）で始まっていれば外して、その都道府県に絞る
  let prefFilter = -1;
  let rem = q;
  prefs.forEach((p, i) => {
    for (const nm of [p[0], shortPref(p[0])]) {
      if (prefFilter < 0 && nm.length >= 2 && q.startsWith(nm)) {
        prefFilter = i;
        rem = q.slice(nm.length);
      }
    }
  });
  const remKey = looseKey(rem);
  const out: Candidate[] = [];
  const label = (pi: number, s: string) => prefs[pi][0] + s;

  // 都道府県そのもの（「東京」「北海」など、都道府県名を打っている途中）
  if (!rem || prefFilter < 0) {
    prefs.forEach((p, i) => {
      if ((prefFilter < 0 && p[0].startsWith(q)) || (!rem && prefFilter === i)) {
        out.push({ kind: "pref", label: p[0], lat: p[2], lng: p[3], n: p[4] });
      }
    });
  }

  // 市区町村
  const cityHits: number[] = [];
  const fullCity: number[] = []; // 入力が市区町村名を含んでいる（その後ろに町域・番地が続く）
  cities.forEach((c, i) => {
    if (prefFilter >= 0 && c[0] !== prefFilter) return;
    if (!rem) {
      if (prefFilter >= 0) cityHits.push(i);
      return;
    }
    if (rem.startsWith(c[1])) fullCity.push(i);
    else if (c[1].startsWith(rem) || (rem.length >= 2 && c[1].includes(rem))) cityHits.push(i);
  });
  for (const i of [...fullCity.filter((i) => rem === cities[i][1]), ...cityHits].slice(0, 4)) {
    const c = cities[i];
    out.push({ kind: "city", label: label(c[0], c[1]), lat: c[2], lng: c[3], n: c[4] });
  }

  // どの都道府県の索引を読むか
  const prefSet = new Set<number>();
  if (rem) {
    if (prefFilter >= 0) prefSet.add(prefFilter);
    for (const i of [...fullCity, ...cityHits]) {
      if (prefSet.size >= 3) break;
      prefSet.add(cities[i][0]);
    }
    // 市区町村名が無い入力（例「成城」「大蔵1-3」）は、町域名の一覧から都道府県を決める
    const townQ = rem.replace(/\d.*$/, "");
    if (prefSet.size === 0 && townQ.length >= 2) {
      const towns = await loadTowns(v);
      if (towns) {
        const hits = prefs
          .map((p, i) => ({ i, n: (towns[p[1]] ?? "").split("|").filter((t) => t.startsWith(townQ)).length }))
          .filter((x) => x.n > 0)
          .sort((a, b) => b.n - a.n)
          .slice(0, 3);
        for (const h of hits) prefSet.add(h.i);
      }
    }
  }
  if (prefSet.size === 0) return out.slice(0, limit);

  const loaded = await Promise.all([...prefSet].map((pi) => loadChunk(prefs[pi][1], v).then((c) => ({ pi, c }))));
  const towns: Array<Candidate & { s: number }> = [];
  const addrs: Array<Candidate & { s: number }> = [];
  for (const { pi, c } of loaded) {
    if (!c) continue;
    for (const t of c.t) {
      const full = cities[t[0]][1] + t[1];
      const s = full.startsWith(rem) ? 0 : t[1].startsWith(rem) ? 1 : rem.startsWith(full) && rem.length === full.length ? 0 : -1;
      if (s >= 0) towns.push({ kind: "town", label: label(pi, full), lat: t[2], lng: t[3], n: t[4], s });
    }
    const keys = keysOf(c);
    for (let j = 0; j < c.a.length; j++) {
      const a = c.a[j];
      const k = keys[j];
      const at = k.indexOf(remKey);
      if (at < 0) continue;
      // 先頭一致（市区町村名から打った）・町域名から一致（市区町村名を省いた）を優先
      const cityLen = cities[a[0]][1].length;
      const s = at === 0 ? 0 : at <= cityLen ? 1 : 2;
      addrs.push({ kind: "addr", label: label(pi, a[1]), lat: a[2], lng: a[3], n: a[4], s });
    }
  }
  towns.sort((a, b) => a.s - b.s || b.n - a.n);
  addrs.sort((a, b) => a.s - b.s || b.n - a.n || a.label.localeCompare(b.label, "ja", { numeric: true }));
  const hasDigits = /\d/.test(rem);
  const townPart = towns.slice(0, hasDigits ? 1 : 4);
  const seen = new Set(out.map((c) => c.label));
  for (const c of [...townPart, ...addrs]) {
    if (out.length >= limit) break;
    if (seen.has(c.label)) continue;
    seen.add(c.label);
    out.push({ kind: c.kind, label: c.label, lat: c.lat, lng: c.lng, n: c.n });
  }
  return out;
}
