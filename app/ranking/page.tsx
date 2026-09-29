import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { abs } from "@/lib/site";
import { listRobots } from "@/lib/indexing";
import { NOT_A_RECOMMENDATION, RANKING_AXES } from "@/lib/ranking";
import Breadcrumb from "@/components/Breadcrumb";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  // 0件（CSV未着）のときはハブも index しない
  const total = await queries.totalCount();
  return {
    title: "並べ替えて探す（ファクト別の一覧）",
    description:
      "定員・同一法人の運営施設数・市区町村あたりの施設数・現在地からの距離といった、公表データの値そのもので並べ替えた一覧です。複数項目を合成した総合ランキングは作成していません。",
    alternates: { canonical: abs("/ranking/") },
    robots: listRobots(total),
  };
}

export default async function RankingIndex() {
  const [meta, total] = await Promise.all([queries.meta(), queries.totalCount()]);

  return (
    <main>
      <Breadcrumb items={[{ name: "ホーム", href: "/" }, { name: "並べ替えて探す" }]} />
      <h1 className="mb-3">並べ替えて探す</h1>

      <div className="mb-6 border-y border-line py-3 text-sm leading-relaxed">
        <p>
          厚生労働省の公表データに入っている値そのもので並べ替えた一覧です。
          どの値で並べているかは、各ページの冒頭に必ず書いています。
        </p>
        <p className="mt-1 text-muted">
          複数の項目を重み付けして合計した「総合ランキング」は作成していません。
          重みの付け方に根拠を示せないためです。
        </p>
        <p className="mt-1 font-bold">{NOT_A_RECOMMENDATION}</p>
      </div>

      {total === 0 && (
        <div className="mb-6">
          <EmptyState detail="データ投入後に、各軸の並べ替え結果をここから開けるようになります。" />
        </div>
      )}

      <section>
        <h2 className="mb-2">並べ替えの軸</h2>
        <ul className="border-t border-line">
          {RANKING_AXES.map((a) => (
            <li key={a.href} className="border-b border-line py-3">
              <Link href={a.href} className="text-sm font-bold text-accent hover:underline">
                {a.label}
              </Link>
              <p className="mt-1 text-sm text-muted">{a.basis}</p>
              <p className="mt-0.5 text-xs text-muted-2">{a.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-xs leading-relaxed text-muted">
        いずれの一覧も、都道府県・サービス種別で絞り込めます。
        絞り込んだ結果が少ない組み合わせのページは、検索エンジンには登録していません。
      </p>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
