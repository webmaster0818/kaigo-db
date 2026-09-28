// インデックス方針（施主承認済み）
//
//   公式URL または 定員 のどちらかがある施設のみ index。
//   それ以外（名称・住所しかない薄いページ）は noindex, follow。
//
// 目的: 中身の薄い数万ページを検索結果に出さない。リンク自体は残すので
// クロールの導線は切らない（follow は付ける）。
//
// この判定は import 時（facility.is_indexable）とページ描画時の両方で使う。
// 片方だけ直すと食い違うので、必ずこの関数を呼ぶこと。

export interface IndexableInput {
  official_url?: string | null;
  capacity?: number | null;
}

/** 施設ページを index してよいか */
export function isIndexableFacility(f: IndexableInput): boolean {
  const hasUrl = typeof f.official_url === "string" && f.official_url.trim().length > 0;
  const hasCapacity = typeof f.capacity === "number" && Number.isFinite(f.capacity) && f.capacity > 0;
  return hasUrl || hasCapacity;
}

export interface RobotsDirective {
  index: boolean;
  follow: boolean;
}

/** Next.js の metadata.robots にそのまま渡せる形 */
export function facilityRobots(f: IndexableInput): RobotsDirective {
  return { index: isIndexableFacility(f), follow: true };
}

/**
 * 一覧ページ（エリア/種別/法人）の判定。
 * 0件のページは index しない（データ未投入時に空ページを量産しないため）。
 */
export function listRobots(count: number): RobotsDirective {
  return { index: count > 0, follow: true };
}
