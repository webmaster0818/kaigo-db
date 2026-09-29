import Link from "next/link";
import type { Metadata } from "next";
import { queries, type PlaceHit } from "@/lib/db";
import { isValidJapanLatLng } from "@/lib/geo";
import { PREF_SLUGS } from "@/lib/slug";
import { REGIONS } from "@/lib/regions";
import { abs, seg, SITE_NAME } from "@/lib/site";
import { NOT_A_RECOMMENDATION, RANKING_AXES } from "@/lib/ranking";
import { TYPE_GUIDES, TYPE_GUIDE_CAVEAT } from "@/lib/typeGuide";
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
    <div className="rounded-xl bg-tint px-3 py-3">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-bold leading-none tabular-nums text-ink">
        {value}
        {unit && <span className="ml-0.5 text-xs font-normal text-muted">{unit}</span>}
      </dd>
      {note && <p className="mt-1.5 text-[11px] leading-tight text-muted-2">{note}</p>}
    </div>
  );
}

function SectionHeading({ icon, title, lead }: { icon?: string; title: string; lead?: string }) {
  return (
    <>
      <h2 className="flex items-center gap-2.5">
        {icon && (
          <img src={icon} alt="" aria-hidden width={40} height={40} className="h-10 w-10 shrink-0 rounded-lg" />
        )}
        {title}
      </h2>
      {lead && <p className="mt-2 mb-4 max-w-3xl text-sm leading-relaxed text-muted">{lead}</p>}
    </>
  );
}

/** トップの3導線。どこから入っても同じデータに辿り着けることを最初に示す */
const ENTRANCES = [
  {
    href: "#search",
    icon: "/img/icon-distance.webp",
    title: "住所・現在地から探す",
    body: "実家の住所を入れると、そこから近い順に並べます。距離は直線距離で、道のりではありません。",
    cta: "検索フォームへ",
  },
  {
    href: "/type/",
    icon: "/img/icon-type.webp",
    title: "サービス種別から探す",
    body: "特養・老健・グループホーム・有料老人ホームの4種別。費用の考え方や入居条件の違いもまとめています。",
    cta: "種別一覧を見る",
  },
  {
    href: "/hojin/",
    icon: "/img/icon-hojin.webp",
    title: "運営法人から探す",
    body: "同じ法人が運営する施設をまとめて確認できます。名寄せは法人名ではなく法人番号（13桁）で行っています。",
    cta: "法人一覧を見る",
  },
];

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
          01 ファーストビュー（見出し＋イラスト＋検索フォーム）
          ===================================================================== */}
      <section>
        <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div>
            <span className="eyebrow">厚生労働省の公表データをそのまま掲載</span>
            <h1 className="mt-3 mb-3">
              親の住まいを、
              <br />
              事実だけで比べる。
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted">
              全国{total > 0 ? total.toLocaleString() : ""}件の介護施設を、住所からの距離・市区町村・サービス種別・運営法人で探せるデータベースです。
              空欄の項目は「記載なし」と表示し、推測では補いません。口コミ・独自の★評価・おすすめ順は掲載していません。
            </p>
          </div>
          {/* 装飾用イラスト。施設や入居者の実写ではないことが見て分かる絵柄にしている */}
          <img
            src="/img/hero.webp"
            alt=""
            aria-hidden
            fetchPriority="high"
            width={1100}
            height={613}
            className="w-full rounded-2xl"
          />
        </div>

        <div id="search" className="mt-6 scroll-mt-20">
          <PlaceSearchForm
            types={types}
            defaults={{ q: qRaw, lat: latRaw, lng: lngRaw, radius: radiusRaw, type: typeRaw, sort }}
          />
        </div>
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
            <div className="card px-4 py-5 text-sm">
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
                  <ul className="mt-1.5 flex flex-wrap gap-2 text-xs">
                    {suggestions.map((s) => (
                      <li key={s.key}>
                        <Link
                          href={`/?q=${encodeURIComponent(s.name)}&radius=${radius}`}
                          className="inline-block rounded-full border border-line bg-tint px-3 py-1 hover:border-accent hover:text-accent"
                        >
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
              <div className="note mb-3 px-4 py-3 text-xs leading-relaxed">
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
                <p className="mt-1.5 text-muted">
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
          02 3つの入口
          ===================================================================== */}
      <section className="mt-12">
        <h2 className="mb-4">探し方は3つあります</h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {ENTRANCES.map((e) => (
            <li key={e.href}>
              <Link href={e.href} className="card card-link flex h-full flex-col p-5">
                <img src={e.icon} alt="" aria-hidden width={56} height={56} className="h-14 w-14 rounded-xl" />
                <span className="mt-3 text-[15px] font-bold leading-snug">{e.title}</span>
                <span className="mt-1.5 flex-1 text-xs leading-relaxed text-muted">{e.body}</span>
                <span className="mt-3 text-xs font-bold text-accent">{e.cta} →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* =====================================================================
          03 このデータベースの規模（実績バッジではなく、数えた事実）
          ===================================================================== */}
      {total > 0 && (
        <section className="mt-10">
          <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatCard label="掲載事業所数" value={total.toLocaleString()} unit="件" note="特養・老健・グループホーム・有料老人ホーム" />
            <StatCard label="掲載市区町村数" value={stats.cities.toLocaleString()} unit="市区町村" note={`うち3件以上あるのは${stats.cities3.toLocaleString()}市区町村`} />
            <StatCard label="運営法人数" value={stats.corporations.toLocaleString()} unit="法人" note="法人番号（13桁）で名寄せした数" />
            <StatCard label="データ取得日" value={meta.acquired_on ?? "-"} note={meta.imported_at ? `取り込み ${meta.imported_at}` : undefined} />
          </dl>
        </section>
      )}

      {/* =====================================================================
          04 エリアから探す（地方 → 都道府県 → 市区町村）
          ===================================================================== */}
      {prefs.length > 0 && (
        <section className="mt-12">
          <SectionHeading
            icon="/img/icon-area.webp"
            title="エリアから探す"
            lead={`地方から都道府県、市区町村の順に絞り込めます。掲載は${stats.prefs}都道府県・${stats.cities.toLocaleString()}市区町村です。数字はその都道府県の掲載件数です。`}
          />
          <div className="grid gap-3 md:grid-cols-2">
            {REGIONS.map((region) => {
              const items = region.prefs.map((name) => {
                const slug = PREF_SLUGS[name];
                return { name, slug, n: Number(prefBySlug.get(slug)?.facility_count ?? 0) };
              });
              return (
                <div key={region.name} className="card p-4">
                  <h3 className="mb-2 border-b border-line pb-1.5 text-accent">{region.name}</h3>
                  <ul className="grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
                    {items.map((p) => (
                      <li key={p.slug} className="flex items-baseline justify-between gap-1 py-1">
                        {p.n > 0 ? (
                          <Link href={`/area/${p.slug}/`} className="hover:text-accent hover:underline">
                            {p.name.replace(/[都府県]$/, "")}
                          </Link>
                        ) : (
                          <span className="text-muted-2">{p.name.replace(/[都府県]$/, "")}</span>
                        )}
                        <span className="tabular-nums text-[11px] text-muted-2">
                          {p.n > 0 ? p.n.toLocaleString() : "-"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {topAreas.length > 0 && (
            <>
              <h3 className="mt-6 mb-2 text-muted">掲載件数の多い市区町村</h3>
              <ul className="flex flex-wrap gap-2 text-sm">
                {topAreas.map((a) => (
                  <li key={`${a.pref_slug}-${a.city_slug}`}>
                    <Link
                      href={`/area/${seg(a.pref_slug)}/${seg(a.city_slug)}/`}
                      className="inline-block rounded-full border border-line bg-surface px-3.5 py-1.5 hover:border-accent hover:text-accent"
                    >
                      {a.prefecture}{a.city}
                      <span className="ml-1.5 tabular-nums text-xs text-muted-2">{a.facility_count.toLocaleString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-4 text-xs">
            <Link href="/area/" className="font-bold text-accent hover:underline">都道府県一覧をすべて見る →</Link>
          </p>
        </section>
      )}

      {/* =====================================================================
          05 種別から探す
          ===================================================================== */}
      {types.length > 0 && (
        <section className="mt-12">
          <SectionHeading
            icon="/img/icon-type.webp"
            title="サービス種別から探す"
            lead="今回の掲載対象は、住まいとして選ぶ入居系4種別です。種別ごとに入居条件も費用の仕組みも違います。"
          />
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[...residential, ...otherTypes].map((t) => {
              const g = TYPE_GUIDES[t.service_type_slug];
              return (
                <li key={t.service_type_slug}>
                  <Link
                    href={`/type/${seg(t.service_type_slug)}/`}
                    className="card card-link flex h-full flex-col px-4 py-4"
                  >
                    {g && (
                      <img src={g.icon} alt="" aria-hidden width={56} height={56} className="h-14 w-14 rounded-xl" />
                    )}
                    <span className="mt-2.5 text-sm font-bold leading-snug">{g?.short ?? t.service_type}</span>
                    <span className="mt-auto pt-3 tabular-nums text-2xl font-bold text-accent">
                      {t.facility_count.toLocaleString()}
                      <span className="ml-0.5 text-xs font-normal text-muted">件</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-2">{TYPE_GUIDE_CAVEAT}</p>
        </section>
      )}

      {/* =====================================================================
          06 運営法人から探す（このサイトの主役）
          ===================================================================== */}
      {topCorps.length > 0 && (
        <section className="mt-12">
          <SectionHeading
            icon="/img/icon-hojin.webp"
            title="運営法人から探す"
            lead="施設は法人単位で運営方針も人の配置も変わります。名寄せは法人名ではなく法人番号（13桁）で行っているため、「社会福祉法人札幌慈啓会」と「社会福祉法人　札幌慈啓会」のような表記の揺れも1つの法人にまとまります。"
          />
          <div className="card overflow-x-auto p-1">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <caption className="sr-only">掲載事業所数の多い運営法人 上位{topCorps.length}法人</caption>
              <thead>
                <tr className="border-b border-line-strong text-left text-xs text-muted">
                  <th scope="col" className="w-10 py-2.5 pl-3 pr-2 text-right font-medium">#</th>
                  <th scope="col" className="py-2.5 pr-3 font-medium">運営法人</th>
                  <th scope="col" className="w-24 py-2.5 pr-3 text-right font-medium">事業所数</th>
                  <th scope="col" className="w-28 py-2.5 pr-3 text-right font-medium">展開都道府県</th>
                </tr>
              </thead>
              <tbody>
                {topCorps.map((c, i) => (
                  <tr key={c.slug} className="border-b border-line last:border-0 hover:bg-tint">
                    <td className="py-2.5 pl-3 pr-2 text-right tabular-nums text-muted-2">{i + 1}</td>
                    <td className="py-2.5 pr-3">
                      <Link href={`/hojin/${seg(c.slug)}/`} className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{c.facility_count.toLocaleString()}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-muted">{c.pref_count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            掲載している{stats.corporations.toLocaleString()}法人のうち、事業所数の多い{topCorps.length}法人です。
            件数は当サイトに掲載している4種別（特養・老健・グループホーム・有料老人ホーム）の範囲での数で、法人の規模そのものではありません。
            全法人は{" "}
            <Link href="/hojin/" className="text-accent hover:underline">運営法人一覧</Link>
            {" "}から辿れます。
          </p>
        </section>
      )}

      {/* =====================================================================
          07 ファクト別の並べ替え
          ===================================================================== */}
      <section className="mt-12">
        <SectionHeading
          title="ファクト別に並べ替える"
          lead="公表データに入っている値そのもの1本で並べ替えた一覧です。複数の項目を重み付けして合成した総合ランキングや、おすすめ順・★評価は作っていません。"
        />
        <p className="note mb-3 px-4 py-3 text-sm font-bold">{NOT_A_RECOMMENDATION}</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {RANKING_AXES.map((a) =>
            // 距離の軸はこのページの検索フォームそのもの。自分自身へのリンクは張らない。
            a.href === "/" ? (
              <li key={a.href} className="rounded-xl border border-dashed border-line-strong bg-tint px-4 py-4">
                <span className="text-sm font-bold text-ink">{a.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">
                  {a.basis}このページ上部の検索フォームがこの並べ替えです。
                </span>
              </li>
            ) : (
              <li key={a.href}>
                <Link href={a.href} className="card card-link block h-full px-4 py-4">
                  <span className="text-sm font-bold text-accent">{a.label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{a.basis}</span>
                </Link>
              </li>
            ),
          )}
        </ul>
      </section>

      {/* =====================================================================
          08 このサイトのデータについて
          ===================================================================== */}
      {total > 0 && (
        <section className="mt-12">
          <SectionHeading
            icon="/img/icon-data.webp"
            title="このサイトのデータについて"
            lead="項目ごとに「どれだけ埋まっているか」を公開しています。欠けている項目は推測で埋めず、そのまま「記載なし」と出します。"
          />
          <div className="card overflow-x-auto p-1">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left text-xs text-muted">
                  <th scope="col" className="py-2.5 pl-3 pr-3 font-medium">項目</th>
                  <th scope="col" className="w-28 py-2.5 pr-3 text-right font-medium">記載あり</th>
                  <th scope="col" className="w-20 py-2.5 pr-3 text-right font-medium">充足率</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["緯度・経度（距離検索に使用）", stats.withGeo],
                  ["法人番号（法人ページの名寄せキー）", covCorpNo],
                  ["公式URL", covUrl],
                  ["定員（1人以上の記載）", covCapacity],
                ].map(([label, n]) => (
                  <tr key={label as string} className="border-b border-line last:border-0">
                    <td className="py-2.5 pl-3 pr-3">{label as string}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{(n as number).toLocaleString()}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{pct(n as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs">
            <Link href="/data/" className="font-bold text-accent hover:underline">全項目の充足率と掲載方針を見る →</Link>
          </p>
        </section>
      )}

      {/* =====================================================================
          09 出典
          ===================================================================== */}
      <SourceNote acquiredOn={meta.acquired_on} />
    </main>
  );
}
