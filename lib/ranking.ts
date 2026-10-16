// 並べ替えの軸の定義（施主承認済みの方針）
//
// 【方針】
//  - 複数の項目を重み付けして合成した「総合ランキング」は作らない。
//    重みの根拠を説明できない以上、それは事実ではなく当サイトの意見になるため。
//  - 作るのは「出典データの1つの値で並べ替えた一覧」だけ。
//    どの値で並べているかを各ページの冒頭に必ず書く。
//  - ★・点数・おすすめ・No.1 などの評価表現は使わない。

import type { TypeCount } from "./db";
import { SLUG_TO_PREF } from "./slug";

/** 全ページ共通の但し書き。文言はここでのみ定義する（ページごとに書き換えない）。 */
export const NOT_A_RECOMMENDATION =
  "この表示順は、当サイトによる評価・推薦を示すものではありません。";

/**
 * 定員ページ冒頭の注記（定員の記載率について）。
 * 出典CSVは定員欄に空欄と 0 が混在しており、1以上の値が入っているのは実測51.1%
 * （31,441件中16,078件／2026-09-29取得分）。
 */
export const CAPACITY_COVERAGE_NOTE =
  "定員に1人以上の記載がある施設は掲載全体の約51%であり、記載のない施設はこの一覧に含めていません。記載がないことは、定員が少ないことを意味するものではありません。";

export interface RankingAxis {
  /** 軸のスラッグ（/ranking/<slug>/。距離だけは既存ページなので href を直接持つ） */
  href: string;
  /** 軸の名前 */
  label: string;
  /** 何を根拠に並べているか（1行） */
  basis: string;
  /** 一覧ハブでの補足 */
  note: string;
  /** sitemap に載せるか（距離検索はトップページなので載せない） */
  inSitemap: boolean;
}

export const RANKING_AXES: RankingAxis[] = [
  {
    href: "/ranking/capacity/",
    label: "定員が多い順",
    basis: "厚生労働省の公表データの「定員」の値が大きい順に表示しています。",
    note: "定員の記載がある施設のみが対象です。記載のない施設は、この一覧に含めていません。",
    inSitemap: true,
  },
  {
    href: "/ranking/hojin-scale/",
    label: "同一法人の運営施設数が多い順",
    basis: "同じ法人番号で登録されている施設の件数が多い順に表示しています。",
    note: "当サイトに掲載している範囲での件数です。法人の同一性は法人名ではなく法人番号（13桁）で判定するため、表記の違いがあっても同一法人として集計しています。法人番号の記載がない施設（掲載全体の1.7%）は、この一覧に含まれません。",
    inSitemap: true,
  },
  {
    href: "/ranking/area-density/",
    label: "市区町村あたりの施設数が多い順",
    basis: "市区町村ごとに、その区域内で登録されている施設の件数が多い順に表示しています。",
    note: "面積・人口あたりの密度ではなく、件数そのものです。人口の多い自治体ほど上位に表示されます。",
    inSitemap: true,
  },
  {
    href: "/",
    label: "住所・現在地から近い順",
    basis: "入力された住所・地名（または現在地）から各施設までの直線距離が短い順に表示しています。",
    note: "トップページの検索フォームで、この順序による検索ができます。緯度・経度の記載がある施設のみが対象です（掲載全体の99.8%）。",
    inSitemap: false,
  },
];

// ---------------------------------------------------------------------------
// クエリパラメータ（?pref=tokyo&type=tokuyo）の解釈
// ---------------------------------------------------------------------------

export interface ParsedRankingParams {
  /** 実在した都道府県スラッグのみ入る */
  prefSlug?: string;
  prefName?: string;
  /** 実在したサービス種別スラッグのみ入る */
  typeSlug?: string;
  typeName?: string;
  /** 適用中の絞り込み数（noindex判定に使う） */
  filters: number;
  /** 実在しないスラッグが指定された（noindex にする） */
  unknownFilter: boolean;
  /** canonical・リンクの組み立て用 */
  query: Record<string, string | undefined>;
}

const one = (v: string | string[] | undefined): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
};

/**
 * クエリパラメータを検証して、DBに渡せる形にする。
 * 実在しないスラッグは「絞り込みとしては無効」にしたうえで unknownFilter を立て、
 * 0件表示 + noindex に落とす（存在しない組み合わせのページを index しないため）。
 */
export function parseRankingParams(
  sp: Record<string, string | string[] | undefined>,
  types: TypeCount[],
  opts: { allowType?: boolean } = {},
): ParsedRankingParams {
  const allowType = opts.allowType !== false;
  const prefRaw = one(sp.pref);
  const typeRaw = allowType ? one(sp.type) : undefined;

  const prefName = prefRaw ? SLUG_TO_PREF[prefRaw] : undefined;
  const t = typeRaw ? types.find((x) => x.service_type_slug === typeRaw) : undefined;

  const unknownFilter = Boolean((prefRaw && !prefName) || (typeRaw && !t));
  const prefSlug = prefName ? prefRaw : undefined;
  const typeSlug = t ? typeRaw : undefined;

  return {
    prefSlug,
    prefName,
    typeSlug,
    typeName: t?.service_type,
    filters: (prefSlug ? 1 : 0) + (typeSlug ? 1 : 0),
    unknownFilter,
    query: { pref: prefSlug, type: typeSlug },
  };
}

/** 見出し・title に付ける条件名（「東京都・特別養護老人ホーム」） */
export function filterLabel(p: ParsedRankingParams): string {
  return [p.prefName, p.typeName].filter(Boolean).join("・");
}

/** クエリパラメータ付きのURLを組み立てる（空の値は落とす） */
export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
