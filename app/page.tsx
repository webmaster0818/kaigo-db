import Link from "next/link";
import type { Metadata } from "next";
import { queries } from "@/lib/db";
import { isValidJapanLatLng } from "@/lib/geo";
import { abs, NO_DATA, seg, SITE_NAME } from "@/lib/site";
import { NOT_A_RECOMMENDATION, RANKING_AXES } from "@/lib/ranking";
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
  // 並べ替えの軸。既定は「近い順」（この検索そのものが距離での並べ替え）。
  const sort = one(sp.sort) === "capacity" ? "capacity" : "distance";

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

  const found = hasQuery && validPoint
    ? await queries.nearby({ lat, lng }, radius, { typeSlug: typeRaw || undefined, limit: 50 })
    : [];

  // nearby() は距離の昇順で返る。定員順にするときだけ並べ直す。
  // 定員の記載が無い施設は「定員が小さい」わけではないので、末尾にまとめて距離順で置く。
  const results =
    sort === "capacity"
      ? [...found].sort((a, b) => {
          const ac = a.capacity ?? null;
          const bc = b.capacity ?? null;
          if (ac == null && bc == null) return a.distance_km - b.distance_km;
          if (ac == null) return 1;
          if (bc == null) return -1;
          return bc - ac || a.distance_km - b.distance_km;
        })
      : found;

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
        defaults={{ lat: latRaw, lng: lngRaw, radius: radiusRaw, type: typeRaw, sort }}
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
          {/* 並べ替えの根拠を必ず明示する（評価・推薦ではないことも併記） */}
          {validPoint && total > 0 && (
            <div className="mb-3 border-y border-line py-2 text-xs leading-relaxed">
              <p>
                {sort === "capacity"
                  ? "厚生労働省の公表データの「定員」の値が大きい順に並べています（定員の記載がない施設は末尾に、近い順で置いています）。"
                  : "入力された緯度・経度から各施設の緯度・経度までの直線距離が短い順に並べています（道のりではありません）。"}
              </p>
              <p className="mt-0.5 font-bold">{NOT_A_RECOMMENDATION}</p>
            </div>
          )}
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

      {/* ---- 並べ替え ---- */}
      <section className="mt-10">
        <h2 className="mb-3">並べ替えて探す</h2>
        <p className="mb-3 text-sm text-muted">
          公表データの値そのもので並べ替えた一覧です。複数項目を合成した総合ランキングは作成していません。
          {NOT_A_RECOMMENDATION}
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {RANKING_AXES.filter((a) => a.href !== "/").map((a) => (
            <li key={a.href}>
              <Link
                href={a.href}
                className="block rounded border border-line bg-surface px-3 py-2 text-sm hover:border-accent hover:text-accent"
              >
                {a.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
