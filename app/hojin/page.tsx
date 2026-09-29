import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { abs, seg } from "@/lib/site";
import Breadcrumb from "@/components/Breadcrumb";
import SourceNote from "@/components/SourceNote";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

const PER_PAGE = 100;

export const metadata: Metadata = {
  title: "運営法人から探す",
  description:
    "介護施設を運営している法人の一覧です。法人番号で名寄せし、同じ法人が運営する施設をまとめて確認できます。厚生労働省の公表データに基づく施設数付き。",
  alternates: { canonical: abs("/hojin/") },
};

export default async function HojinIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp?.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [meta, corps] = await Promise.all([
    queries.meta(),
    queries.corporationsByScale({}, PER_PAGE + 1, offset),
  ]);

  const hasNext = corps.length > PER_PAGE;
  const rows = corps.slice(0, PER_PAGE);

  return (
    <main>
      <Breadcrumb items={[{ name: "ホーム", href: "/" }, { name: "運営法人から探す" }]} />
      <h1 className="mb-2">運営法人から探す</h1>
      <p className="mb-2 text-sm text-muted">
        施設を運営している法人の一覧です。<strong>法人番号で名寄せ</strong>しているため、
        「社会福祉法人○○」と「社会福祉法人　○○」のような表記の違いがあっても同じ法人としてまとめています。
      </p>
      <p className="mb-5 text-xs text-muted">
        並び順は「運営している施設数が多い順」です。施設数の多さは規模を示すもので、
        <strong>当サイトによる評価・推薦ではありません</strong>。
        法人番号の記載がない施設は法人ページを作成していません。
      </p>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 pr-3 font-medium">法人名</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">施設数</th>
                  <th className="py-2 font-medium whitespace-nowrap">都道府県数</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.slug} className="border-b border-line/60">
                    <td className="py-2 pr-3">
                      <Link href={`/hojin/${seg(c.slug)}/`} className="underline hover:text-accent">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{Number(c.facility_count || 0).toLocaleString()}</td>
                    <td className="py-2 tabular-nums">{c.pref_count ? Number(c.pref_count).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="mt-6 flex items-center justify-between text-sm">
            {page > 1 ? (
              <Link href={`/hojin/?page=${page - 1}`} className="underline hover:text-accent">
                ← 前の{PER_PAGE}件
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted">ページ {page}</span>
            {hasNext ? (
              <Link href={`/hojin/?page=${page + 1}`} className="underline hover:text-accent">
                次の{PER_PAGE}件 →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}

      <SourceNote acquiredOn={meta?.acquired_on ?? null} />
    </main>
  );
}
