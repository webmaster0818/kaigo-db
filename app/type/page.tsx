import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { abs, seg } from "@/lib/site";
import { TYPE_GUIDES, TYPE_GUIDE_CAVEAT } from "@/lib/typeGuide";
import Breadcrumb from "@/components/Breadcrumb";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "サービス種別から探す",
  description:
    "特別養護老人ホーム・介護老人保健施設・グループホーム・介護付き有料老人ホームの4種別について、制度上の位置づけと全国の掲載事業所数をまとめています。種別ごとに事業所を検索できます。",
  alternates: { canonical: abs("/type/") },
};

export default async function TypeIndex() {
  const [meta, types] = await Promise.all([queries.meta(), queries.typeCounts()]);
  const residential = types.filter((t) => t.is_residential === 1);
  const homeCare = types.filter((t) => t.is_residential !== 1);

  return (
    <main>
      <Breadcrumb items={[{ name: "ホーム", href: "/" }, { name: "サービス種別から探す" }]} />
      <h1 className="mb-2">サービス種別から探す</h1>
      <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted">
        「住まいとして選ぶ」入居系の4種別は、対象となる要介護度も、運営している主体も、費用の仕組みも違います。
        まず種別の違いを押さえてから、エリアや距離で絞り込むと探しやすくなります。
      </p>

      {types.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {residential.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4">住まい（入居系）</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {residential.map((t) => {
                  const g = TYPE_GUIDES[t.service_type_slug];
                  return (
                    <li key={t.service_type_slug}>
                      <Link
                        href={`/type/${seg(t.service_type_slug)}/`}
                        className="card card-link flex h-full flex-col p-5"
                      >
                        <div className="flex items-start gap-3">
                          {g && (
                            <img
                              src={g.icon}
                              alt=""
                              aria-hidden
                              width={64}
                              height={64}
                              className="h-16 w-16 shrink-0 rounded-xl"
                            />
                          )}
                          <div className="min-w-0">
                            <span className="block text-[15px] font-bold leading-snug">
                              {g?.short ?? t.service_type}
                            </span>
                            <span className="mt-1 block text-[11px] leading-snug text-muted-2">
                              {t.service_type}
                            </span>
                          </div>
                          <span className="ml-auto shrink-0 text-right">
                            <span className="block tabular-nums text-xl font-bold text-accent">
                              {t.facility_count.toLocaleString()}
                            </span>
                            <span className="block text-[11px] text-muted">件</span>
                          </span>
                        </div>

                        {g && (
                          <>
                            <p className="mt-3 text-xs leading-relaxed text-muted">{g.summary}</p>
                            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-[11px] leading-relaxed">
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

                        <span className="mt-3 text-xs font-bold text-accent">この種別の事業所を見る →</span>
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
                      className="inline-block rounded-full border border-line bg-surface px-3.5 py-1.5 hover:border-accent hover:text-accent"
                    >
                      {t.service_type}
                      <span className="ml-1.5 tabular-nums text-xs text-muted-2">
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
