import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { abs, seg } from "@/lib/site";
import { TYPE_GUIDES, TYPE_GUIDE_CAVEAT } from "@/lib/typeGuide";
import Breadcrumb from "@/components/Breadcrumb";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";
import Icon from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "サービス種別から探す",
  description:
    "特別養護老人ホーム・介護老人保健施設・グループホーム・介護付き有料老人ホームの4種別について、制度上の位置づけと全国の掲載施設数をまとめています。種別ごとに施設を検索できます。",
  alternates: { canonical: abs("/type/") },
};

export default async function TypeIndex() {
  const [meta, types] = await Promise.all([queries.meta(), queries.typeCounts()]);
  const residential = types.filter((t) => t.is_residential === 1);
  const homeCare = types.filter((t) => t.is_residential !== 1);

  return (
    <main>
      <Breadcrumb items={[{ name: "ホーム", href: "/" }, { name: "サービス種別から探す" }]} />
      <h1 className="mb-3">サービス種別から探す</h1>
      <p className="mb-10 max-w-3xl text-sm leading-relaxed text-muted">
        住まいとして利用する入居系の4種別は、対象となる要介護度、運営主体、費用の仕組みがそれぞれ異なります。
        種別の違いを確認したうえで、エリアや距離で絞り込むと、施設を探しやすくなります。
      </p>

      {types.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {residential.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-5">住まい（入居系）</h2>
              <ul className="grid gap-4 sm:grid-cols-2">
                {residential.map((t) => {
                  const g = TYPE_GUIDES[t.service_type_slug];
                  return (
                    <li key={t.service_type_slug} className="reveal">
                      <Link
                        href={`/type/${seg(t.service_type_slug)}/`}
                        className="card card-link flex h-full flex-col p-6"
                      >
                        <div className="flex items-start gap-4">
                          {g && <Icon name={g.icon} size={64} />}
                          <div className="min-w-0">
                            <span className="block text-[15px] font-bold leading-snug">
                              {g?.short ?? t.service_type}
                            </span>
                            <span className="mt-1 block text-[11px] leading-snug text-muted-2">
                              {t.service_type}
                            </span>
                          </div>
                          <span className="ml-auto shrink-0 text-right">
                            <span className="block font-display text-2xl leading-none tabular-nums text-ink">
                              {t.facility_count.toLocaleString()}
                            </span>
                            <span className="mt-1 block text-[11px] text-muted">件</span>
                          </span>
                        </div>

                        {g && (
                          <>
                            <p className="mt-4 text-xs leading-relaxed text-muted">{g.summary}</p>
                            <dl className="mt-4 space-y-1 border-t border-line pt-4 text-[11px] leading-relaxed">
                              <div className="flex gap-2">
                                <dt className="w-16 shrink-0 text-muted-2">対象</dt>
                                <dd className="text-muted">{g.target}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-16 shrink-0 text-muted-2">運営</dt>
                                <dd className="text-muted">{g.operator}</dd>
                              </div>
                            </dl>
                          </>
                        )}

                        <span className="mt-5 border-t border-line pt-4 text-[13px] font-bold tracking-wider text-accent">この種別の施設一覧 →</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-2">{TYPE_GUIDE_CAVEAT}</p>
            </section>
          )}

          {homeCare.length > 0 && (
            <section>
              <h2 className="mb-3">在宅サービス</h2>
              <ul className="flex flex-wrap gap-2 text-sm">
                {homeCare.map((t) => (
                  <li key={t.service_type_slug}>
                    <Link
                      href={`/type/${seg(t.service_type_slug)}/`}
                      className="chip"
                    >
                      {t.service_type}
                      <span className="chip-count">
                        {t.facility_count.toLocaleString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
