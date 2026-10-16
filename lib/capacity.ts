// 定員の妥当性ガード
//
// 出典CSV（2026-09-29 取得）の「定員」列に、日付（20191021 / 20241225 など8桁）が入っている行が
// 2件あった。数字だけ拾うと「20241225人」になり /ranking/capacity/ の1位に出てしまう。
//
// 閾値: 実データの最大定員は 604（有料老人ホーム）。種別ごとの最大は
//   特養 304 / 老健 298 / 有料 604 / グループホーム 85（日付2件を除く）。
// 実在の施設で 1,000 を超えることはまず無いので、1〜1000 の範囲外は「値なし」として扱う。
// 推測で直した値は入れない（範囲外 → NULL）。

export const MAX_PLAUSIBLE_CAPACITY = 1000;

/** 範囲外（0以下・1000超・非数）は null */
export function plausibleCapacity(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_PLAUSIBLE_CAPACITY ? n : null;
}

/** SQL 側の同じ条件（定数のみ。ユーザー入力は入らない） */
export const CAPACITY_OK_SQL = `capacity IS NOT NULL AND capacity > 0 AND capacity <= ${MAX_PLAUSIBLE_CAPACITY}`;
