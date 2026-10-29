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
    "掲載データの出典・取得日・件数と、項目ごとの充足率（記載がある施設の割合）を公開しています。記載のない項目は推測で補完せず、「記載なし」と表示しています。",
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

      <section className="mb-12">
        <h2 className="mb-4">出典とライセンス</h2>
        <dl className="card text-sm">
          {[
            ["出典", <a key="s" href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{SOURCE_NAME}</a>],
            ["ライセンス", <a key="l" href={LICENSE_URL} target="_blank" rel="license noopener noreferrer" className="text-accent hover:underline">{LICENSE_NAME}</a>],
            ["データ取得日", meta.acquired_on ?? NO_DATA],
            ["最終取り込み", meta.imported_at ?? NO_DATA],
            ["掲載施設数", total > 0 ? `${total.toLocaleString()}件` : "0件（準備中）"],
          ].map(([k, v], i) => (
            <div key={i} className="grid grid-cols-1 gap-1 border-b border-line px-4 py-3.5 last:border-0 sm:grid-cols-[10rem_1fr] sm:gap-4 sm:px-6">
              <dt className="text-xs text-muted">{k as string}</dt>
              <dd className="text-sm">{v as React.ReactNode}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-12">
        <h2 className="mb-4">項目ごとの充足率</h2>
        <p className="mb-3 text-sm leading-relaxed text-muted">
          「充足率」は、その項目に値が記載されている施設の割合です。記載のない項目は「{NO_DATA}」と表示し、
          推定値による補完は行っていません。
          <br />
          出典CSVに列が存在しない項目（郵便番号など）は、この表に掲載していません。
          「利用可能曜日」は列が存在しますが、掲載している入居系4種別ではすべて空欄のため、0%となっています。
          「定員」は空欄と 0 が混在しており、0は未記入の意味で使用されているため、1人以上の記載のみを集計しています。
        </p>

        {total === 0 ? (
          <EmptyState detail="データの掲載後に、項目ごとの充足率をこのページで集計して公開します。" />
        ) : (
          <>
            {/* PC: 表 */}
            <div className="card hidden md:block">
              <table className="dtable w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line-strong text-left text-xs text-muted">
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
            <ul className="space-y-3 md:hidden">
              {coverage.fields.map((f) => (
                <li key={f.key} className="card p-4 text-sm">
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
        <section className="mb-12">
          <h2 className="mb-4">サービス種別ごとの件数と充足率</h2>
          <div className="card overflow-x-auto">
            <table className="dtable w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left text-xs text-muted">
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

      <section className="mb-12">
        <h2 className="mb-4">掲載方針</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>記載のない項目は推測で補完せず、「{NO_DATA}」と表示しています。</li>
          <li>公式URLまたは定員のいずれかが記載されている施設のページのみを、検索エンジンへの登録対象としています。情報量の少ないページを大量に登録することを避けるためです。</li>
          <li>口コミ・独自の評価は掲載していません。判断の根拠となるデータを保有していないためです。星・点数・おすすめといった評価表現も使用していません。</li>
          <li>
            電話相談の窓口は設けておりません。相談員を配置しておらず、助言を行う体制がないためです。
            連絡先は、各施設が公表している電話番号をそのまま掲載しています。
          </li>
          <li>
            運営法人ページでは、法人名ではなく<strong>法人番号（13桁）</strong>で同一法人を判定しています。
            法人名で判定すると、表記の違いにより同じ法人が複数のページに分かれ、同名の別法人が混在するためです。
            法人番号の記載がない施設については法人ページを作成せず、施設ページに出典の法人名のみを表示しています。
          </li>
          <li>
            住所・地名からの距離検索では、掲載施設の緯度・経度から作成した地名辞書により座標に変換しています
            （外部の地図サービス・ジオコーディングAPIは使用していません）。掲載施設のない地域の地名は検索できません。
          </li>
          <li>
            複数の項目を重み付けして合計した「総合ランキング」は作成していません。重み付けの根拠を示すことができないためです。
            公表データの値にもとづいて並べ替えた一覧（定員・法人の運営施設数・市区町村あたりの施設数・現在地からの距離）のみを
            <a href="/ranking/" className="text-accent hover:underline">並べ替えて探す</a>
            に掲載しています。いずれも当サイトによる評価・推薦を示すものではありません。
          </li>
          <li>掲載内容は取得日時点の公表データです。ご利用前に、各施設に最新の状況をご確認ください。</li>
        </ul>
      </section>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
