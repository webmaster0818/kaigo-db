import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { abs, seg } from "@/lib/site";
import Breadcrumb from "@/components/Breadcrumb";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "サービス種別から探す",
  description:
    "有料老人ホーム・グループホーム・特別養護老人ホーム・介護老人保健施設などのサービス種別ごとに、全国の事業所を検索できます。",
  alternates: { canonical: abs("/type/") },
};

export default async function TypeIndex() {
  const [meta, types] = await Promise.all([queries.meta(), queries.typeCounts()]);
  const residential = types.filter((t) => t.is_residential === 1);
  const homeCare = types.filter((t) => t.is_residential !== 1);

  const Table = ({ rows }: { rows: typeof types }) => (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-ink text-left text-xs text-muted">
          <th scope="col" className="py-2 pr-3 font-medium">サービス種別</th>
          <th scope="col" className="w-28 py-2 text-right font-medium">事業所数</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.service_type_slug} className="border-b border-line hover:bg-tint">
            <td className="py-2 pr-3">
              <Link href={`/type/${seg(t.service_type_slug)}/`} className="hover:text-accent hover:underline">
                {t.service_type}
              </Link>
            </td>
            <td className="py-2 text-right tabular-nums">{t.facility_count.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <main>
      <Breadcrumb items={[{ name: "ホーム", href: "/" }, { name: "サービス種別から探す" }]} />
      <h1 className="mb-4">サービス種別から探す</h1>

      {types.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {residential.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-2">住まい（入居系）</h2>
              <Table rows={residential} />
            </section>
          )}
          {homeCare.length > 0 && (
            <section>
              <h2 className="mb-2">在宅サービス</h2>
              <Table rows={homeCare} />
            </section>
          )}
        </>
      )}

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
