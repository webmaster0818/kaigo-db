// URLスラッグ生成。import 時に確定し、DBに保存する。
// （= ここを変えたら import をやり直せばURL体系を丸ごと差し替えられる）

/** 47都道府県のローマ字スラッグ。CSVの表記ゆれ（「都府県」抜き）も吸収する。 */
export const PREF_SLUGS: Record<string, string> = {
  北海道: "hokkaido",
  青森県: "aomori",
  岩手県: "iwate",
  宮城県: "miyagi",
  秋田県: "akita",
  山形県: "yamagata",
  福島県: "fukushima",
  茨城県: "ibaraki",
  栃木県: "tochigi",
  群馬県: "gunma",
  埼玉県: "saitama",
  千葉県: "chiba",
  東京都: "tokyo",
  神奈川県: "kanagawa",
  新潟県: "niigata",
  富山県: "toyama",
  石川県: "ishikawa",
  福井県: "fukui",
  山梨県: "yamanashi",
  長野県: "nagano",
  岐阜県: "gifu",
  静岡県: "shizuoka",
  愛知県: "aichi",
  三重県: "mie",
  滋賀県: "shiga",
  京都府: "kyoto",
  大阪府: "osaka",
  兵庫県: "hyogo",
  奈良県: "nara",
  和歌山県: "wakayama",
  鳥取県: "tottori",
  島根県: "shimane",
  岡山県: "okayama",
  広島県: "hiroshima",
  山口県: "yamaguchi",
  徳島県: "tokushima",
  香川県: "kagawa",
  愛媛県: "ehime",
  高知県: "kochi",
  福岡県: "fukuoka",
  佐賀県: "saga",
  長崎県: "nagasaki",
  熊本県: "kumamoto",
  大分県: "oita",
  宮崎県: "miyazaki",
  鹿児島県: "kagoshima",
  沖縄県: "okinawa",
};

/** スラッグ→都道府県名の逆引き */
export const SLUG_TO_PREF: Record<string, string> = Object.fromEntries(
  Object.entries(PREF_SLUGS).map(([k, v]) => [v, k]),
);

/** 都道府県の表示順（北から南） */
export const PREF_ORDER: string[] = Object.keys(PREF_SLUGS);

/**
 * 都道府県名 → スラッグ。
 * 「東京」「東京都」どちらでも同じスラッグになるようにする。
 * 未知の表記は空文字を返す（import 側で警告する）。
 */
export function prefSlug(name: string | null | undefined): string {
  if (!name) return "";
  const s = name.trim();
  if (PREF_SLUGS[s]) return PREF_SLUGS[s];
  for (const [full, slug] of Object.entries(PREF_SLUGS)) {
    // 「東京」→「東京都」、「北海道」はそのまま
    if (full.replace(/[都道府県]$/, "") === s) return slug;
  }
  return "";
}

/**
 * 市区町村スラッグ。
 * 【未確定】約1,700市区町村のローマ字辞書を持っていないため、暫定で
 * 「漢字の市区町村名そのもの」をスラッグにしている（例: /area/tokyo/世田谷区/）。
 * 日本語URLはGoogleも正しく扱えるが、ローマ字に寄せたい場合はこの関数だけを
 * 差し替えて import をやり直せばよい（DBに保存された値がURLの実体）。
 */
export function citySlug(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().replace(/\s+/g, "").replace(/[/?#%&]/g, "");
}

const CORP_PREFIXES = [
  "株式会社",
  "有限会社",
  "合同会社",
  "合資会社",
  "合名会社",
  "医療法人社団",
  "医療法人財団",
  "医療法人",
  "社会福祉法人",
  "公益財団法人",
  "公益社団法人",
  "一般財団法人",
  "一般社団法人",
  "特定非営利活動法人",
  "宗教法人",
  "学校法人",
  "農業協同組合連合会",
  "生活協同組合連合会",
  "生活協同組合",
  "協同組合",
];

/**
 * 法人名 → スラッグの素（衝突解決前）。
 * 法人格の表記（株式会社/社会福祉法人 …）は前後どちらにあっても落とす。
 * 【未確定】市区町村と同じ理由で日本語を残している。
 */
export function corpSlugBase(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.trim().replace(/\s+/g, "");
  for (const p of CORP_PREFIXES) {
    if (s.startsWith(p)) { s = s.slice(p.length); break; }
    if (s.endsWith(p)) { s = s.slice(0, -p.length); break; }
  }
  s = s.replace(/[/?#%&（）()「」【】]/g, "");
  return s || (name.trim().replace(/\s+/g, "") || "");
}

/** 決定的な短いハッシュ（未知サービス種別のスラッグなどに使う） */
export function shortHash(input: string): string {
  // FNV-1a 32bit
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
