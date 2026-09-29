import Link from "next/link";
import type { Metadata } from "next";
import { queries, type PlaceHit } from "@/lib/db";
import { isValidJapanLatLng } from "@/lib/geo";
import { PREF_ORDER, PREF_SLUGS } from "@/lib/slug";
import { abs, seg, SITE_NAME } from "@/lib/site";
import { NOT_A_RECOMMENDATION, RANKING_AXES } from "@/lib/ranking";
import PlaceSearchForm from "@/components/PlaceSearchForm";
import FacilityTable from "@/components/FacilityTable";
import EmptyState from "@/components/EmptyState";
import SourceNote from "@/components/SourceNote";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${SITE_NAME}｜実データで探す介護施設データベース`,
  description:
    "厚生労働省の公表データをそのまま検索できる介護施設データベースです。住所・地名からの距離、運営法人（法人番号）、市区町村、サービス種別で探せます。口コミ・独自ランキング・おすすめ順はありません。",
  alternates: { canonical: abs("/") },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** 地名をどう解釈したかを1行で説明する（利用者に根拠を見せる） */
function matchNote(hit: PlaceHit, input: string): string {
  const where = `「${hit.name}」（掲載${hit.facility_count.toLocaleString()}件の平均位置）`;
  switch (hit.match) {
    case "station":
      return `「${input}」は駅名として解釈せず、同じ名前の地名 ${where} を起点にしました。駅の座標そのものは掲載していません。`;
    case "exact":
    case "prefix":
      return `入力された住所から ${where} を起点にしました。`;
    default:
      return `「${input}」に一致する地名として ${where} を起点にしました。`;
  }
}

function StatCard({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="border-l-2 border-accent bg-surface px-3 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-bold leading-none tabular-nums text-ink">
        {value}
        {unit && <span className="ml-0.5 text-xs font-normal text-muted">{unit}</span>}
      </dd>
      {note && <p className="mt-1 text-[11px] leading-tight text-muted-2">{note}</p>}
    </div>
  );
}

function SectionHeading({ n, title, lead }: { n: number; title: string; lead?: string }) {
  return (
    <>
      <h2 className="flex items-baseline gap-2">
        <span className="tabular-nums text-xs font-normal text-muted-2">{String(n).padStart(2, "0")}</span>
        {title}
      </h2>
      {lead && <p className="mt-1 mb-3 max-w-3xl text-sm leading-relaxed text-muted">{lead}</p>}
    </>
  );
}

export default async function Home({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const qRaw = (one(sp.q) ?? "").trim();
  const latRaw = one(sp.lat);
  const lngRaw = one(sp.lng);
  const radiusRaw = one(sp.radius);
  const typeRaw = one(sp.type);
  const sort = one(sp.sort) === "capacity" ? "capacity" : "distance";

  const radius = Math.min(50, Math.max(0.5, Number(radiusRaw) || 3));
  const lat = latRaw ? Number(latRaw) : NaN;
  const lng = lngRaw ? Number(lngRaw) : NaN;
  const hasCoords = Boolean(latRaw && lngRaw) && isValidJapanLatLng(
    Number.isFinite(lat) ? lat : null,
    Number.isFinite(lng) ? lng : null,
  );
  const searched = qRaw.length > 0 || Boolean(latRaw && lngRaw);

  const [meta, stats, types, prefs, topAreas, topCorps] = await Promise.all([
    queries.meta(),
    queries.siteStats(),
    queries.typeCounts(),
    queries.prefectures(),
    queries.topAreas(12),
    queries.topCorporations(10),
  ]);

  // 起点の決定。座標が直接来ていればそれを、無ければ入力された地名を辞書で引く。
  const hit = !hasCoords && qRaw ? await queries.resolvePlace(qRaw) : undefined;
  const origin = hasCoords ? { lat, lng } : hit ? { lat: hit.lat, lng: hit.lng } : null;
  const suggestions = searched && !origin && qRaw ? await queries.placeSuggestions(qRaw, 8) : [];

  const found = origin
    ? await queries.nearby(origin, radius, { typeSlug: typeRaw || undefined, limit: 50 })
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

  const total = stats.facilities;
  const residential = types.filter((t) => t.is_residential === 1);
  const otherTypes = types.filter((t) => t.is_residential !== 1);
  const prefBySlug = new Map(prefs.map((p) => [p.pref_slug, p]));

  const covUrl = Number(meta.cov_url ?? 0);
  const covCapacity = Number(meta.cov_capacity ?? 0);
  const covCorpNo = Number(meta.cov_corporate_number ?? 0);
  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "-");

  // 検索条件を保ったまま並べ替えだけ切り替えるリンク
  const sortHref = (s: "distance" | "capacity") => {
    const p = new URLSearchParams();
    if (qRaw) p.set("q", qRaw);
    if (hasCoords) { p.set("lat", String(lat)); p.set("lng", String(lng)); }
    p.set("radius", String(radius));
    if (typeRaw) p.set("type", typeRaw);
    p.set("sort", s);
    return `/?${p.toString()}`;
  };

  return (
    <main>
      {/* =====================================================================
          01 ファーストビュー
          ===================================================================== */}
      <section>
        <h1 className="mb-2">実データで探す介護施設データベース</h1>
        <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted">
          厚生労働省「介護サービス情報公表システム」の公表データを、加工せずそのまま検索できる形にしたものです。
          住所・地名からの距離、運営法人、市区町村、サービス種別で絞り込めます。
          空欄の項目は「記載なし」と表示し、推測では補いません。
        </p>

        <PlaceSearchForm
          types={types}
          defaults={{ q: qRaw, lat: latRaw, lng: lngRaw, radius: radiusRaw, type: typeRaw, sort }}
        />

        {total > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatCard label="掲載事業所数" value={total.toLocaleString()} unit="件" note="特養・老健・グループホーム・有料老人ホーム" />
            <StatCard label="掲載市区町村数" value={stats.cities.toLocaleString()} unit="市区町村" note={`うち3件以上あるのは${stats.cities3.toLocaleString()}市区町村`} />
            <StatCard label="運営法人数" value={stats.corporations.toLocaleString()} unit="法人" note="法人番号（13桁）で名寄せした数" />
            <StatCard label="データ取得日" value={meta.acquired_on ?? "-"} note={meta.imported_at ? `取り込み ${meta.imported_at}` : undefined} />
          </dl>
        )}
      </section>

      {/* ---- 検索結果 ---- */}
      {searched && (
        <section className="mt-8">
          <h2 className="mb-2">
            検索結果
            {origin && (
              <span className="ml-2 text-xs font-normal tabular-nums text-muted">
                {radius}km以内 ／ {results.length}件
              </span>
            )}
          </h2>

          {total === 0 ? (
            <EmptyState />
          ) : !origin ? (
            <div className="rounded border border-line-strong bg-surface px-4 py-5 text-sm">
              <p className="font-bold">
                {qRaw ? `「${qRaw}」に一致する地名が見つかりませんでした。` : "緯度・経度の値が正しくありません（日本国内の範囲で入力してください）。"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                地名は掲載データの住所から作っているため、掲載施設が1件も無い地域は検索できません。
                市区町村名（例: 世田谷区、札幌市中央区）まで戻すと見つかりやすくなります。
              </p>
              {suggestions.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-bold">もしかして:</p>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {suggestions.map((s) => (
                      <li key={s.key}>
                        <Link href={`/?q=${encodeURIComponent(s.name)}&radius=${radius}`} className="text-accent hover:underline">
                          {s.name}
                          <span className="ml-1 tabular-nums text-muted-2">{s.facility_count.toLocaleString()}件</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <>
              {/* 起点と並べ替えの根拠を必ず書く */}
              <div className="mb-3 border-y border-line py-2 text-xs leading-relaxed">
                <p>
                  {hit
                    ? matchNote(hit, qRaw)
                    : `入力された緯度・経度（${lat.toFixed(4)}, ${lng.toFixed(4)}）を起点にしました。`}
                </p>
                <p className="mt-0.5">
                  {sort === "capacity"
                    ? "公表データの「定員」の値が大きい順に並べています（定員の記載がない施設は末尾に、近い順で置いています）。"
                    : "起点から各施設の緯度・経度までの直線距離が短い順に並べています（道のりではありません）。"}
                </p>
                <p className="mt-0.5 font-bold">{NOT_A_RECOMMENDATION}</p>
                <p className="mt-1 text-muted">
                  並べ替え:{" "}
                  {sort === "distance" ? <strong>近い順</strong> : <Link href={sortHref("distance")} className="text-accent hover:underline">近い順</Link>}
                  {" ／ "}
                  {sort === "capacity" ? <strong>定員が多い順</strong> : <Link href={sortHref("capacity")} className="text-accent hover:underline">定員が多い順</Link>}
                </p>
              </div>
              <FacilityTable rows={results} showDistance />
              {results.length === 0 && (
                <p className="mt-2 text-xs text-muted">距離を広げるか、サービス種別の絞り込みを外してみてください。</p>
              )}
            </>
          )}
        </section>
      )}

      {total === 0 && !searched && (
        <section className="mt-8">
          <EmptyState />
        </section>
      )}

      {/* =====================================================================
          02 運営法人から探す（このサイトの主役）
          ===================================================================== */}
      {topCorps.length > 0 && (
        <section className="mt-12">
          <SectionHeading
            n={2}
            title="運営法人から探す"
            lead="施設は法人単位で運営方針も人の配置も変わります。名寄せは法人名ではなく法人番号（13桁）で行っているため、「社会福祉法人札幌慈啓会」と「社会福祉法人　札幌慈啓会」のような表記の揺れも1つの法人にまとまります。"
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <caption className="sr-only">掲載事業所数の多い運営法人 上位{topCorps.length}法人</caption>
              <thead>
                <tr className="border-b-2 border-ink text-left text-xs text-muted">
                  <th scope="col" className="w-8 py-2 pr-2 text-right font-medium">#</th>
                  <th scope="col" className="py-2 pr-3 font-medium">運営法人</th>
                  <th scope="col" className="w-24 py-2 pr-3 text-right font-medium">事業所数</th>
                  <th scope="col" className="w-28 py-2 text-right font-medium">展開都道府県</th>
                </tr>
              </thead>
              <tbody>
                {topCorps.map((c, i) => (
                  <tr key={c.slug} className="border-b border-line hover:bg-tint">
                    <td className="py-2 pr-2 text-right tabular-nums text-muted-2">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/hojin/${seg(c.slug)}/`} className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.facility_count.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{c.pref_count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            掲載している{stats.corporations.toLocaleString()}法人のうち、事業所数の多い{topCorps.length}法人です。
            件数は当サイトに掲載している4種別（特養・老健・グループホーム・有料老人ホーム）の範囲での数で、法人の規模そのものではありません。
            全法人は{" "}
            <Link href="/ranking/hojin-scale/" className="text-accent hover:underline">同一法人の運営施設数が多い順</Link>
            {" "}から辿れます。
          </p>
        </section>
      )}

      {/* =====================================================================
          03 種別から探す
          ===================================================================== */}
      {types.length > 0 && (
        <section className="mt-12">
          <SectionHeading n={3} title="種別から探す" lead="今回の掲載対象は、住まいとして選ぶ入居系4種別です。" />
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[...residential, ...otherTypes].map((t) => (
              <li key={t.service_type_slug}>
                <Link
                  href={`/type/${seg(t.service_type_slug)}/`}
                  className="flex h-full flex-col justify-between rounded border border-line bg-surface px-3 py-3 hover:border-accent"
                >
                  <span className="text-sm font-medium leading-snug">{t.service_type}</span>
                  <span className="mt-2 tabular-nums text-lg font-bold">
                    {t.facility_count.toLocaleString()}
                    <span className="ml-0.5 text-xs font-normal text-muted">件</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* =====================================================================
          04 エリアから探す
          ===================================================================== */}
      {prefs.length > 0 && (
        <section className="mt-12">
          <SectionHeading
            n={4}
            title="エリアから探す"
            lead={`都道府県を選ぶと市区町村の一覧に進みます。掲載は${stats.prefs}都道府県・${stats.cities.toLocaleString()}市区町村です。`}
          />
          <ul className="grid gap-x-4 gap-y-0 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {PREF_ORDER.map((name) => {
              const slug = PREF_SLUGS[name];
              const n = Number(prefBySlug.get(slug)?.facility_count ?? 0);
              return (
                <li key={slug} className="flex items-baseline justify-between border-b border-line py-1.5">
                  {n > 0 ? (
                    <Link href={`/area/${slug}/`} className="hover:text-accent hover:underline">{name}</Link>
                  ) : (
                    <span className="text-muted-2">{name}</span>
                  )}
                  <span className="tabular-nums text-xs text-muted">{n > 0 ? n.toLocaleString() : "-"}</span>
                </li>
              );
            })}
          </ul>

          {topAreas.length > 0 && (
            <>
              <h3 className="mt-6 mb-2 text-muted">掲載件数の多い市区町村</h3>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {topAreas.map((a) => (
                  <li key={`${a.pref_slug}-${a.city_slug}`}>
                    <Link href={`/area/${seg(a.pref_slug)}/${seg(a.city_slug)}/`} className="hover:text-accent hover:underline">
                      {a.prefecture}{a.city}
                      <span className="ml-1 tabular-nums text-xs text-muted-2">{a.facility_count.toLocaleString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-3 text-xs">
            <Link href="/area/" className="text-accent hover:underline">都道府県一覧をすべて見る →</Link>
          </p>
        </section>
      )}

      {/* =====================================================================
          05 ファクト別の並べ替え
          ===================================================================== */}
      <section className="mt-12">
        <SectionHeading
          n={5}
          title="ファクト別に並べ替える"
          lead="公表データに入っている値そのもの1本で並べ替えた一覧です。複数の項目を重み付けして合成した総合ランキングや、おすすめ順・★評価は作っていません。"
        />
        <p className="mb-3 border-y border-line py-2 text-sm font-bold">{NOT_A_RECOMMENDATION}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {RANKING_AXES.map((a) =>
            // 距離の軸はこのページの検索フォームそのもの。自分自身へのリンクは張らない。
            a.href === "/" ? (
              <li key={a.href} className="rounded border border-dashed border-line-strong bg-tint px-3 py-3">
                <span className="text-sm font-bold text-ink">{a.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">
                  {a.basis}このページ上部の検索フォームがこの並べ替えです。
                </span>
              </li>
            ) : (
              <li key={a.href}>
                <Link
                  href={a.href}
                  className="block h-full rounded border border-line bg-surface px-3 py-3 hover:border-accent"
                >
                  <span className="text-sm font-bold text-accent">{a.label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{a.basis}</span>
                </Link>
              </li>
            ),
          )}
        </ul>
      </section>

      {/* =====================================================================
          06 このサイトのデータについて
          ===================================================================== */}
      {total > 0 && (
        <section className="mt-12">
          <SectionHeading
            n={6}
            title="このサイトのデータについて"
            lead="項目ごとに「どれだけ埋まっているか」を公開しています。欠けている項目は推測で埋めず、そのまま「記載なし」と出します。"
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">項目</th>
                  <th scope="col" className="w-28 py-2 pr-3 text-right font-medium">記載あり</th>
                  <th scope="col" className="w-20 py-2 text-right font-medium">充足率</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["緯度・経度（距離検索に使用）", stats.withGeo],
                  ["法人番号（法人ページの名寄せキー）", covCorpNo],
                  ["公式URL", covUrl],
                  ["定員（1人以上の記載）", covCapacity],
                ].map(([label, n]) => (
                  <tr key={label as string} className="border-b border-line">
                    <td className="py-2 pr-3">{label as string}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{(n as number).toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{pct(n as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs">
            <Link href="/data/" className="text-accent hover:underline">全項目の充足率と掲載方針を見る →</Link>
          </p>
        </section>
      )}

      {/* =====================================================================
          07 出典
          ===================================================================== */}
      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
