import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queries } from "@/lib/db";
import { abs, decodeParam, seg } from "@/lib/site";
import { listRobots } from "@/lib/indexing";
import Breadcrumb from "@/components/Breadcrumb";
import FacilityTable from "@/components/FacilityTable";
import SourceNote from "@/components/SourceNote";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug: slugRaw } = await params;
  const slug = decodeParam(slugRaw);
  const c = await queries.corporationBySlug(slug);
  if (!c) return { title: "法人が見つかりません", robots: { index: false, follow: true } };
  return {
    title: `${c.name}が運営する介護事業所一覧`,
    description: `${c.name}が運営する介護事業所${c.facility_count.toLocaleString()}件の一覧。所在地・サービス種別・定員を厚生労働省の公表データから掲載しています。`,
    alternates: { canonical: abs(`/hojin/${seg(slug)}/`) },
    robots: listRobots(c.facility_count),
  };
}

export default async function HojinPage({ params }: { params: Params }) {
  const { slug: slugRaw } = await params;
  const slug = decodeParam(slugRaw);
  const c = await queries.corporationBySlug(slug);
  if (!c) notFound();

  const [meta, rows] = await Promise.all([queries.meta(), queries.facilitiesByCorp(slug, 300)]);

  // 運営主体は Place ではなく Organization（施設そのものではないため）
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: c.name,
    url: abs(`/hojin/${seg(slug)}/`),
    // 国税庁の法人番号。同名の別法人と取り違えられないよう識別子として出す。
    identifier: { "@type": "PropertyValue", name: "法人番号", value: c.corporate_number },
  };

  const types = new Map<string, number>();
  for (const r of rows) types.set(r.service_type, (types.get(r.service_type) ?? 0) + 1);

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Breadcrumb items={[{ name: "ホーム", href: "/" }, { name: c.name }]} />
      <h1 className="mb-3">{c.name}が運営する介護事業所</h1>

      <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-2 border-y border-line py-3 text-sm">
        <div>
          <dt className="text-xs text-muted">事業所数</dt>
          <dd className="tabular-nums text-lg font-bold">{c.facility_count.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">展開都道府県</dt>
          <dd className="tabular-nums text-lg font-bold">{c.pref_count.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">サービス種別</dt>
          <dd className="tabular-nums text-lg font-bold">{types.size.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">法人番号</dt>
          <dd className="tabular-nums text-lg font-bold">{c.corporate_number}</dd>
        </div>
      </dl>

      <FacilityTable rows={rows} hideCorp />

      {c.facility_count > rows.length && (
        <p className="mt-3 text-xs text-muted">
          全{c.facility_count.toLocaleString()}件のうち{rows.length.toLocaleString()}件を表示しています。
        </p>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        このページは法人名ではなく<strong>法人番号（{c.corporate_number}）</strong>で事業所をまとめています。
        同名の別法人は別のページになり、表記が揺れている同一法人は1ページにまとまります。
        {c.name_variants > 1 && (
          <>
            {" "}出典データではこの法人の名称が{c.name_variants}通りの表記で登録されていたため、
            最も多く使われていた表記を見出しに採用しています。
          </>
        )}
        {" "}法人番号の記載がない事業所（掲載全体の約1.7%）は、どの法人ページにも含まれません。
      </p>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
