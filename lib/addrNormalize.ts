// 住所の候補表示（トップの住所・地名入力）で使う正規化。
// scripts/gen-addr-index.ts（ビルド時に索引を作る）と components/AddressAutocomplete.tsx（ブラウザで照合する）の
// 両方から使う。どちらも同じ関数を通すことで、全角/半角・ハイフンの違いで一致しない事故を防ぐ。

const HYPHENS = /[‐‑‒–—―−－ｰ﹣⁃]/g;

const KANJI: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 「三丁目」「十二丁目」などの漢数字を算用数字に（丁目の前だけ。地名の漢数字は変えない） */
function kanjiChome(k: string): string {
  let n = 0;
  if (k.includes("十")) {
    const [a, b] = k.split("十");
    n = (a ? KANJI[a] ?? 0 : 1) * 10 + (b ? KANJI[b] ?? 0 : 0);
  } else n = KANJI[k] ?? 0;
  return n > 0 ? String(n) : k;
}

/** 表示用の正規化：NFKC（全角数字→半角など）・空白除去・ハイフン類を「-」に統一・丁目の漢数字を算用数字に */
export function normalizeAddr(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/([一二三四五六七八九十]{1,3})丁目/g, (_, k: string) => `${kanjiChome(k)}丁目`)
    .replace(/\s+/g, "")
    .replace(HYPHENS, "-")
    // 数字の直後の長音記号はハイフンの代わりに使われている（例: ４５２ー１）
    .replace(/(\d)ー(?=\d)/g, "$1-");
}

/**
 * 照合用のキー：「6丁目1番地2号」「6-1-2」「6の1の2」を同じ「6-1-2」にそろえる。
 * 表示には使わない（normalizeAddr の結果を出す）。
 */
export function looseKey(s: string): string {
  return normalizeAddr(s)
    .replace(/(\d+)(?:丁目|番地|番|号|の)(?=\d)/g, "$1-")
    .replace(/(\d+)(?:丁目|番地|番|号)$/g, "$1")
    .replace(/-+/g, "-")
    .replace(/-$/, "");
}

// 番地までで切る。最初の数字から「区切り（丁目・番地・番・号・条・線・地割・-・の・東西南北）＋数字」が続く範囲を残し、
// その後ろ（建物名・階数など）を落とす。例: 「荒田1丁目11-13階・4階」→「荒田1丁目11-13」
const SEP = "(?:丁目|丁|番地|番|号|条|線|地割|-|の|東|西|南|北)";
const BANCHI = new RegExp(`^(.*?\\d+(?:${SEP}+\\d+)*(?:丁目|番地|番|号)?)`);

/** 住所（NFKC 済み）を番地までにする。数字が無ければそのまま返す */
export function cutToBanchi(addr: string): string {
  const s = normalizeAddr(addr);
  const m = BANCHI.exec(s);
  return m ? m[1] : s;
}
