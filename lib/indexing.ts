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

// ---------------------------------------------------------------------------
// 並べ替え一覧（/ranking/*）の判定
// ---------------------------------------------------------------------------
//
// 並べ替えページは「都道府県 × サービス種別」をクエリパラメータで受けるため、
// 放っておくと組み合わせの数だけ薄いページが生える。
// 施設ページと同じ考え方（中身が薄いものは index しない）を一覧にも適用する。

/** 絞り込みを1つ掛けたページを index する最低行数 */
export const RANKING_MIN_ROWS = 10;

export interface RankingIndexInput {
  /** 実際に並べ替えて表示できた行数 */
  rows: number;
  /** 適用中の絞り込みの数（都道府県・サービス種別） */
  filters: number;
  /** 未知のスラッグが指定された（存在しない都道府県・種別） */
  unknownFilter?: boolean;
}

/**
 * 並べ替え一覧を index してよいか。
 *
 *   未知スラッグ        → noindex（実在しない組み合わせ）
 *   0件                 → noindex（データ未投入・該当なし）
 *   絞り込みなし        → index（軸そのもののページ）
 *   絞り込み1つ         → RANKING_MIN_ROWS 行以上なら index
 *   絞り込み2つ以上     → noindex（組み合わせが薄いため）
 *
 * noindex でも follow は付ける（各行から施設・エリア・法人ページへ辿れるため）。
 */
export function isIndexableRanking(i: RankingIndexInput): boolean {
  if (i.unknownFilter) return false;
  if (i.rows <= 0) return false;
  if (i.filters <= 0) return true;
  if (i.filters === 1) return i.rows >= RANKING_MIN_ROWS;
  return false;
}

export function rankingRobots(i: RankingIndexInput): RobotsDirective {
  return { index: isIndexableRanking(i), follow: true };
}
