import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { isValidJapanLatLng } from "@/lib/geo";
import { abs, NO_DATA, seg, SITE_NAME } from "@/lib/site";
import GeoSearchForm from "@/components/GeoSearchForm";
import FacilityTable from "@/components/FacilityTable";
import EmptyState from "@/components/EmptyState";
import SourceNote from "@/components/SourceNote";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${SITE_NAME}｜全国の介護施設・事業所データベース`,
  description:
    "厚生労働省の公表データをもとに、現在地からの距離・市区町村・サービス種別・運営法人で介護施設を検索できます。口コミ・独自ランキングはありません。",
  alternates: { canonical: abs("/") },
};

type SP = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function Home({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const latRaw = one(sp.lat);
  const lngRaw = one(sp.lng);
  const radiusRaw = one(sp.radius);
  const typeRaw = one(sp.type);

  const lat = latRaw ? Number(latRaw) : NaN;
  const lng = lngRaw ? Number(lngRaw) : NaN;
  const radius = Math.min(50, Math.max(0.5, Number(radiusRaw) || 3));
  const hasQuery = Boolean(latRaw && lngRaw);
  const validPoint = isValidJapanLatLng(Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null);

  const [meta, total, types, topAreas, topCorps] = await Promise.all([
    queries.meta(),
    queries.totalCount(),
    queries.typeCounts(),
    queries.topAreas(24),
    queries.topCorporations(12),
  ]);

  const results = hasQuery && validPoint
    ? await queries.nearby({ lat, lng }, radius, { typeSlug: typeRaw || undefined, limit: 50 })
    : [];

  const residential = types.filter((t) => t.is_residential === 1);
  const homeCare = types.filter((t) => t.is_residential !== 1);

  return (
    <main>
      <h1 className="mb-2">全国の介護施設・事業所データベース</h1>
      <p className="mb-5 max-w-3xl text-sm leading-relaxed text-muted">
        厚生労働省「介護サービス情報公表システム」の公表データを、そのまま検索できる形にしたものです。
        {total > 0 && <> 現在の掲載件数は<strong className="tabular-nums text-ink">{total.toLocaleString()}</strong>件。</>}
        {" "}
        空欄の項目は「{NO_DATA}」と表示し、推測では補いません。口コミ・独自評価・ランキングは掲載していません。
      </p>

      <GeoSearchForm
        types={types}
        defaults={{ lat: latRaw, lng: lngRaw, radius: radiusRaw, type: typeRaw }}
      />

      {/* ---- 検索結果 ---- */}
      {hasQuery && (
        <section className="mt-8">
          <h2 className="mb-3">
            検索結果
            {validPoint && (
              <span className="ml-2 text-xs font-normal text-muted tabular-nums">
                中心 {lat.toFixed(4)}, {lng.toFixed(4)} ／ {radius}km以内 ／ {results.length}件
              </span>
            )}
          </h2>
          {!validPoint ? (
            <p className="rounded border border-line bg-surface px-4 py-6 text-sm text-muted">
              緯度・経度の値が正しくありません（日本国内の範囲で入力してください）。
            </p>
          ) : total === 0 ? (
            <EmptyState />
          ) : (
            <FacilityTable rows={results} showDistance />
          )}
        </section>
      )}

      {/* ---- データが無いときの案内 ---- */}
      {total === 0 && !hasQuery && (
        <section className="mt-8">
          <EmptyState />
        </section>
      )}

      {/* ---- サービス種別 ---- */}
      {types.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3">サービス種別から探す</h2>
          {residential.length > 0 && (
            <>
              <h3 className="mb-2 text-muted">住まい（入居系）</h3>
              <ul className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {residential.map((t) => (
                  <li key={t.service_type_slug}>
                    <Link
                      href={`/type/${seg(t.service_type_slug)}/`}
                      className="flex items-baseline justify-between rounded border border-line bg-surface px-3 py-2 text-sm hover:border-accent hover:text-accent"
                    >
                      <span>{t.service_type}</span>
                      <span className="tabular-nums text-xs text-muted">{t.facility_count.toLocaleString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {homeCare.length > 0 && (
            <>
              <h3 className="mb-2 text-muted">在宅サービス</h3>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {homeCare.map((t) => (
                  <li key={t.service_type_slug}>
                    <Link
                      href={`/type/${seg(t.service_type_slug)}/`}
                      className="flex items-baseline justify-between rounded border border-line bg-surface px-3 py-2 text-sm hover:border-accent hover:text-accent"
                    >
                      <span>{t.service_type}</span>
                      <span className="tabular-nums text-xs text-muted">{t.facility_count.toLocaleString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ---- エリア ---- */}
      {topAreas.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3">掲載件数の多い市区町村</h2>
          <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {topAreas.map((a) => (
              <li key={`${a.pref_slug}-${a.city_slug}`} className="flex items-baseline justify-between border-b border-line py-1">
                <Link href={`/area/${seg(a.pref_slug)}/${seg(a.city_slug)}/`} className="hover:text-accent hover:underline">
                  {a.prefecture}{a.city}
                </Link>
                <span className="tabular-nums text-xs text-muted">{a.facility_count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs">
            <Link href="/area/" className="text-accent hover:underline">都道府県一覧から探す →</Link>
          </p>
        </section>
      )}

      {/* ---- 法人 ---- */}
      {topCorps.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3">事業所数の多い運営法人</h2>
          <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {topCorps.map((c) => (
              <li key={c.slug} className="flex items-baseline justify-between border-b border-line py-1">
                <Link href={`/hojin/${seg(c.slug)}/`} className="hover:text-accent hover:underline">{c.name}</Link>
                <span className="tabular-nums text-xs text-muted">{c.facility_count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
