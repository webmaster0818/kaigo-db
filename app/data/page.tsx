import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { abs, LICENSE_NAME, LICENSE_URL, NO_DATA, SOURCE_NAME, SOURCE_URL } from "@/lib/site";
import Breadcrumb from "@/components/Breadcrumb";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "データについて（件数と項目ごとの充足率）",
  description:
    "掲載データの出典・取得日・件数と、項目ごとの充足率（記載がある事業所の割合）を公開しています。欠損は推測で補わず「記載なし」と表示する方針です。",
  alternates: { canonical: abs("/data/") },
};

function pct(n: number, total: number): string {
  if (total <= 0) return "-";
  return `${((n / total) * 100).toFixed(1)}%`;
}

/** 充足率のバー。色は1色のみ、目盛りは数値で読ませる。 */
function Bar({ value }: { value: number }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <span className="inline-block h-2 w-full max-w-[160px] bg-line align-middle" aria-hidden="true">
      <span className="block h-2 bg-accent" style={{ width: `${w}%` }} />
    </span>
  );
}

export default async function DataPage() {
  const [meta, coverage, byType] = await Promise.all([
    queries.meta(),
    queries.coverage(),
    queries.coverageByType(),
  ]);
  const total = coverage.total;

  return (
    <main>
      <Breadcrumb items={[{ name: "ホーム", href: "/" }, { name: "データについて" }]} />
      <h1 className="mb-3">データについて</h1>

      <section className="mb-8">
        <h2 className="mb-2">出典とライセンス</h2>
        <dl className="border-t border-line text-sm">
          {[
            ["出典", <a key="s" href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{SOURCE_NAME}</a>],
            ["ライセンス", <a key="l" href={LICENSE_URL} target="_blank" rel="license noopener noreferrer" className="text-accent hover:underline">{LICENSE_NAME}</a>],
            ["データ取得日", meta.acquired_on ?? NO_DATA],
            ["最終取り込み", meta.imported_at ?? NO_DATA],
            ["掲載事業所数", total > 0 ? `${total.toLocaleString()}件` : "0件（準備中）"],
          ].map(([k, v], i) => (
            <div key={i} className="grid grid-cols-1 gap-0.5 border-b border-line py-2 sm:grid-cols-[10rem_1fr] sm:gap-3">
              <dt className="text-xs text-muted">{k as string}</dt>
              <dd className="text-sm">{v as React.ReactNode}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-8">
        <h2 className="mb-2">項目ごとの充足率</h2>
        <p className="mb-3 text-sm leading-relaxed text-muted">
          「充足率」は、その項目に値が入っている事業所の割合です。値が無いものは当サイトでも空欄のまま「{NO_DATA}」と表示し、
          推定値では補いません。
          <br />
          出典CSVに列そのものが無い項目（郵便番号など）は、この表に載せていません。
          「利用可能曜日」は列はありますが、掲載している入居系4種別では全件が空欄のため0%になります。
          「定員」は空欄と 0 が混在しており、0は未記入の意味で使われているため1人以上の記載だけを数えています。
        </p>

        {total === 0 ? (
          <EmptyState detail="データ投入後に、項目ごとの充足率をここで自動集計して公開します。" />
        ) : (
          <>
            {/* PC: 表 */}
            <div className="hidden md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink text-left text-xs text-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">項目</th>
                    <th scope="col" className="w-28 py-2 pr-3 text-right font-medium">記載あり</th>
                    <th scope="col" className="w-20 py-2 pr-3 text-right font-medium">充足率</th>
                    <th scope="col" className="w-48 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.fields.map((f) => (
                    <tr key={f.key} className="border-b border-line">
                      <td className="py-2 pr-3">{f.label}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.filled.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(f.filled, total)}</td>
                      <td className="py-2"><Bar value={(f.filled / total) * 100} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* スマホ: カード */}
            <ul className="space-y-2 md:hidden">
              {coverage.fields.map((f) => (
                <li key={f.key} className="rounded border border-line bg-surface p-3 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span>{f.label}</span>
                    <span className="tabular-nums text-xs text-muted">
                      {f.filled.toLocaleString()} / {total.toLocaleString()}（{pct(f.filled, total)}）
                    </span>
                  </div>
                  <div className="mt-2"><Bar value={(f.filled / total) * 100} /></div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {byType.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2">サービス種別ごとの件数と充足率</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">サービス種別</th>
                  <th scope="col" className="w-24 py-2 pr-3 text-right font-medium">件数</th>
                  <th scope="col" className="w-28 py-2 pr-3 text-right font-medium">定員あり</th>
                  <th scope="col" className="w-28 py-2 text-right font-medium">公式URLあり</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((t) => (
                  <tr key={t.service_type_slug} className="border-b border-line">
                    <td className="py-2 pr-3">{t.service_type}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{Number(t.n).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{pct(Number(t.f_capacity), Number(t.n))}</td>
                    <td className="py-2 text-right tabular-nums">{pct(Number(t.f_url), Number(t.n))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-2">掲載方針</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>欠損値は推測で補わず「{NO_DATA}」と表示します。</li>
          <li>公式URLか定員のいずれかが記載されている事業所のページのみ検索エンジンに登録します（情報量が乏しいページを大量に登録しないため）。</li>
          <li>口コミ・独自評価は掲載しません（判断の根拠となるデータを持たないため）。星・点数・おすすめといった評価表現も使いません。</li>
          <li>
            電話相談の窓口は設けていません（相談員が居らず、助言できる体制を持たないためです）。
            連絡先は各事業所の公表電話番号をそのまま掲載しています。
          </li>
          <li>
            運営法人ページは法人名ではなく<strong>法人番号（13桁）</strong>で名寄せしています。
            法人名で寄せると表記の揺れで同じ法人が複数ページに割れ、同名の別法人が混ざるためです。
            法人番号の記載がない事業所は法人ページを作らず、施設ページに出典の法人名だけを表示します。
          </li>
          <li>
            住所・地名からの距離検索は、掲載施設の緯度・経度から作った地名辞書で座標に変換しています
            （外部の地図サービス・ジオコーディングAPIは使っていません）。掲載施設が無い地域の地名は解決できません。
          </li>
          <li>
            複数の項目を重み付けして合計した「総合ランキング」は作成しません（重みの付け方に根拠を示せないため）。
            公表データの値そのもので並べ替えた一覧（定員・法人の運営施設数・市区町村あたりの施設数・現在地からの距離）のみを
            <a href="/ranking/" className="text-accent hover:underline">並べ替えて探す</a>
            に置いています。いずれも当サイトによる評価・推薦ではありません。
          </li>
          <li>掲載内容は取得日時点の公表データです。最新の状況は各事業所へ直接ご確認ください。</li>
        </ul>
      </section>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
