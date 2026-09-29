// サイト共通定数
//
// 本番ドメイン: kaigo-database.com（2026-09-29 取得）。環境変数で上書き可。
// .env / wrangler の vars に設定するか、ここの既定値を書き換える。
// canonical はページごとの自己参照でこの値を使う（layout に canonical:'/' は置かない）。

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://kaigo-database.com").replace(/\/$/, "");
export const SITE_NAME = "かいごDB";
export const SITE_TAGLINE = "介護施設データベース";

/** 出典表示（CC BY 4.0 の要求事項） */
export const SOURCE_NAME = "厚生労働省 介護サービス情報公表システム";
export const SOURCE_URL = "https://www.mhlw.go.jp/stf/kaigo-kouhyou.html";
export const LICENSE_NAME = "CC BY 4.0";
export const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/deed.ja";

/** 値が無いときの共通表記。推測で埋めない。 */
export const NO_DATA = "記載なし";

export function orNoData(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return NO_DATA;
  const s = String(v).trim();
  return s === "" ? NO_DATA : s;
}

/** 絶対URL（canonical / JSON-LD 用） */
export function abs(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 日本語を含むパスセグメントを安全にURL化する */
export function seg(s: string): string {
  return encodeURIComponent(s);
}

/**
 * 動的ルートの params をデコードする。
 * Next.js は params をパーセントエンコードされたまま渡すため、
 * 日本語スラッグ（市区町村・法人）をDBの値と突き合わせるには必ずこれを通す。
 */
export function decodeParam(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
