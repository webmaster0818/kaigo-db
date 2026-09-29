import { NOT_A_RECOMMENDATION } from "@/lib/ranking";

/**
 * 並べ替え一覧の冒頭に必ず出す2点セット。
 *  1) 何を根拠に並べているか
 *  2) これは当サイトの評価・推薦ではない、という但し書き
 *
 * 文言は lib/ranking.ts に集約している（ページごとに言い換えない）。
 */
export default function RankingNote({
  basis,
  extra,
}: {
  /** この並びの根拠（1行） */
  basis: string;
  /** 軸ごとの追加注記（定員の記載率など） */
  extra?: string;
}) {
  return (
    <div className="mb-5 border-y border-line py-3 text-sm leading-relaxed">
      <p className="text-ink">{basis}</p>
      {extra && <p className="mt-1 text-muted">{extra}</p>}
      <p className="mt-1 font-bold text-ink">{NOT_A_RECOMMENDATION}</p>
    </div>
  );
}
