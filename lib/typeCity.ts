// 種別×市区町村ページ（/type/{種別}/{都道府県}/{市区町村}/）の共通定義（2026-11-01 okina 承認）。
//
// 作るのは「その市区町村にその種別の index 対象施設（公式URLか定員の記載あり）が3件以上ある組み合わせ」だけ。
// 3件未満は市区町村ページ（全種別まとめ）と内容がほぼ重なるため作らない（404・sitemap にも載せない）。
// 判定はこのファイルの関数に集約し、scripts/agg.sql（sitemap 用の一覧）・lib/direct.ts（ページ）・
// 市区町村ページのリンクの3か所が同じ基準を使う。agg.sql の `>= 3` もこの値と揃えること。
//
// 描画は Next を通さず worker.ts → lib/direct.ts の renderTypeCity で行う（CPU 上限対策・設計は README 参照）。

import { seg } from "./site";

/** ページを作る最低件数（index 対象施設の数） */
export const TYPE_CITY_MIN_INDEXABLE = 3;

/** 掲載中4種別の、ページの見出しに使う呼び名（正式名は本文に出す） */
export const TYPE_CITY_LABELS: Record<string, string> = {
  tokuyo: "特別養護老人ホーム（特養）",
  roken: "介護老人保健施設（老健）",
  "group-home": "認知症グループホーム",
  "yuryo-rojin-home": "介護付き有料老人ホーム",
};

export function typeCityPath(type: string, pref: string, city: string): string {
  return `/type/${seg(type)}/${seg(pref)}/${seg(city)}/`;
}

/** index 対象施設の数からページを作るかどうか */
export function qualifiesTypeCity(indexableCount: number): boolean {
  return indexableCount >= TYPE_CITY_MIN_INDEXABLE;
}

/**
 * sitemap・関連リンク用の組み合わせ一覧の1行。agg 'typeCityCombos'（scripts/agg.sql）と同じ並び。
 * [種別スラッグ, 都道府県スラッグ, 市区町村スラッグ, 施設数]
 */
export type TypeCityCombo = [string, string, string, number];

/** 定員の内訳の区切り（出典の「定員」の値をそのまま数える。記載のない施設は別に数える） */
export const CAPACITY_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: "9人以下", min: 1, max: 9 },
  { label: "10〜19人", min: 10, max: 19 },
  { label: "20〜29人", min: 20, max: 29 },
  { label: "30〜49人", min: 30, max: 49 },
  { label: "50〜99人", min: 50, max: 99 },
  { label: "100人以上", min: 100, max: Number.MAX_SAFE_INTEGER },
];
