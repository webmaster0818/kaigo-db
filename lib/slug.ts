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

/**
 * 法人番号（13桁）→ 法人ページのスラッグ。
 *
 * 法人の名寄せキーは法人名ではなく法人番号にしている。
 * 法人名で寄せると「社会福祉法人札幌慈啓会」と「社会福祉法人　札幌慈啓会」が別ページに割れ、
 * 逆に同名の別法人が1ページに混ざる。法人番号なら表記に左右されない。
 *
 * 法人番号が無い／13桁でない場合は空文字を返す＝法人ページを作らない。
 */
export function corpSlugFromNumber(corporateNumber: string | null | undefined): string {
  const n = normalizeCorporateNumber(corporateNumber);
  return n ? `c${n}` : "";
}

/** 法人番号を13桁の半角数字に正規化する。13桁でなければ空文字。 */
export function normalizeCorporateNumber(v: string | null | undefined): string {
  if (!v) return "";
  const digits = toHankakuDigits(String(v)).replace(/[^0-9]/g, "");
  return digits.length === 13 ? digits : "";
}

/** 全角数字を半角に寄せる（法人番号・検索キーの比較用） */
export function toHankakuDigits(s: string): string {
  return s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 法人名の比較用の正規化。
 * 出典には全角スペース・半角スペースの有無だけが違う表記が多数あるため、
 * 空白をすべて落としたうえで比較し、「最も多く出現した表記」を表示名に採用する。
 */
export function normalizeCorpName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/[\s　]+/g, "").trim();
}

/**
 * 住所・地名の検索キー正規化。
 * 全角英数字を半角に、空白・ハイフン類の揺れを落として比較できる形にする。
 * （place テーブルの key と、利用者が入力した文字列の双方に同じ関数を通す）
 */
export function placeKey(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .replace(/[‐－―ー−–—]/g, "-")
    .trim();
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
