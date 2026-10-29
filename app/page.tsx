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
import HeroVisual from "@/components/HeroVisual";
import Icon, { type IconName } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${SITE_NAME}｜厚生労働省の公表データにもとづく介護施設データベース`,
  description:
    "厚生労働省の公表データにもとづく介護施設データベースです。住所・地名からの距離、運営法人（法人番号）、市区町村、サービス種別で施設を検索できます。口コミ・独自のランキング・おすすめ順は掲載していません。",
  alternates: { canonical: abs("/") },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** 地名をどう解釈したかを1行で説明する（利用者に根拠を見せる） */
function matchNote(hit: PlaceHit, input: string): string {
  const where = `「${hit.name}」（掲載${hit.facility_count.toLocaleString()}件の平均位置）`;
  switch (hit.match) {
    case "station":
      return `「${input}」は駅名としてではなく、同じ名称の地名 ${where} として検索の起点にしています。駅の座標は掲載していません。`;
    case "exact":
    case "prefix":
      return `入力された住所にもとづき、${where} を検索の起点にしています。`;
    default:
      return `「${input}」に一致する地名として、${where} を検索の起点にしています。`;
  }
}

function StatCard({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="bg-surface px-4 py-5 md:px-6 md:py-6">
      <dt className="text-xs tracking-wider text-muted">{label}</dt>
      <dd className="mt-2 font-display text-2xl leading-none tabular-nums text-ink md:text-[1.9rem]">
        {value}
        {unit && <span className="ml-1 font-sans text-xs text-muted">{unit}</span>}
      </dd>
      {note && <p className="mt-2.5 text-[11px] leading-snug text-muted-2">{note}</p>}
    </div>
  );
}

function SectionHeading({ icon, title, lead }: { icon?: IconName; title: string; lead?: string }) {
  return (
    <div className="mb-6 border-t border-line-strong pt-8 md:pt-10">
      <h2 className="flex items-center gap-4">
        {icon && <Icon name={icon} size={52} />}
        {title}
      </h2>
      {lead && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{lead}</p>}
    </div>
  );
}

/** トップの3導線。どこから入っても同じデータに辿り着けることを最初に示す */
const ENTRANCES = [
  {
    href: "#search",
    icon: "distance" as IconName,
    title: "住所・現在地から探す",
    body: "入力した住所から近い順に施設を表示します。距離は直線距離であり、道のりではありません。",
    cta: "検索フォーム",
  },
  {
    href: "/type/",
    icon: "type" as IconName,
    title: "サービス種別から探す",
    body: "特養・老健・グループホーム・有料老人ホームの4種別を掲載しています。種別ごとの費用の考え方や入居条件の違いもまとめています。",
    cta: "種別一覧",
  },
  {
    href: "/hojin/",
    icon: "hojin" as IconName,
    title: "運営法人から探す",
    body: "同じ法人が運営する施設をまとめて確認できます。法人の同一性は、法人名ではなく法人番号（13桁）で判定しています。",
    cta: "法人一覧",
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
      <section className="pt-2 md:pt-6">
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-4">
          <div>
            <span className="eyebrow">厚生労働省の公表データにもとづく施設情報</span>
            <h1 className="mt-5 mb-5 text-[2rem] leading-[1.4] md:text-[2.75rem]">
              公表データにもとづく
              <br />
              介護施設の検索
            </h1>
            <p className="max-w-xl text-sm leading-[2] text-muted">
              全国{total > 0 ? total.toLocaleString() : ""}件の介護施設を、住所からの距離・市区町村・サービス種別・運営法人で検索できるデータベースです。
              公表データに記載のない項目は「記載なし」と表示し、推測による補完は行っていません。口コミ・独自の★評価・おすすめ順は掲載していません。
            </p>
          </div>
          {/* 装飾用の画像。差し替えは components/HeroVisual.tsx */}
          <HeroVisual />
        </div>

        <div id="search" className="mt-8 scroll-mt-24 md:mt-6">
          <PlaceSearchForm
            types={types}
            defaults={{ q: qRaw, lat: latRaw, lng: lngRaw, radius: radiusRaw, type: typeRaw, sort }}
          />
        </div>
      </section>

      {/* ---- 検索結果 ---- */}
      {searched && (
        <section className="mt-12">
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
                {qRaw ? `「${qRaw}」に一致する地名は見つかりませんでした。` : "緯度・経度の値が正しくありません（日本国内の範囲で入力してください）。"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                地名は掲載データの住所から作成しているため、掲載施設のない地域は検索できません。
                市区町村名（例: 世田谷区、札幌市中央区）で検索すると、該当する地名が見つかりやすくなります。
              </p>
              {suggestions.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-bold">候補となる地名:</p>
                  <ul className="mt-1.5 flex flex-wrap gap-2 text-xs">
                    {suggestions.map((s) => (
                      <li key={s.key}>
                        <Link
                          href={`/?q=${encodeURIComponent(s.name)}&radius=${radius}`}
                          className="chip"
                        >
                          {s.name}
                          <span className="chip-count">{s.facility_count.toLocaleString()}件</span>
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
                    : `入力された緯度・経度（${lat.toFixed(4)}, ${lng.toFixed(4)}）を検索の起点にしています。`}
                </p>
                <p className="mt-0.5">
                  {sort === "capacity"
                    ? "公表データの「定員」の値が大きい順に表示しています（定員の記載がない施設は、末尾に近い順で表示しています）。"
                    : "起点から各施設の緯度・経度までの直線距離が短い順に表示しています（道のりではありません）。"}
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
                <p className="mt-2 text-xs text-muted">該当する施設はありません。距離を広げるか、サービス種別の絞り込みを解除してください。</p>
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
          02 エリアから探す（地方 → 都道府県 → 市区町村）
          検索フォームの直後に置く。都道府県を選ぶと /area/<pref>/ の市区町村一覧へ、そこから施設一覧へ進む。
          ===================================================================== */}
      {prefs.length > 0 && (
        <section id="area" className="mt-16 scroll-mt-24 md:mt-20">
          <SectionHeading
            icon="area"
            title="エリアから探す"
            lead={`地方、都道府県、市区町村の順に絞り込むことができます。掲載範囲は${stats.prefs}都道府県・${stats.cities.toLocaleString()}市区町村です。数字は各都道府県の掲載件数です。`}
          />
          <ol className="steps reveal mb-6" aria-label="エリアから探す手順">
            <li><span className="step-no">1</span>都道府県を選ぶ</li>
            <li><span className="step-no">2</span>市区町村を選ぶ</li>
            <li><span className="step-no">3</span>施設の一覧を見る</li>
          </ol>
          <div className="grid gap-4 md:grid-cols-2">
            {REGIONS.map((region) => {
              const items = region.prefs.map((name) => {
                const slug = PREF_SLUGS[name];
                return { name, slug, n: Number(prefBySlug.get(slug)?.facility_count ?? 0) };
              });
              return (
                <div key={region.name} className="card reveal p-5">
                  <h3 className="mb-3 flex items-center gap-3 text-[15px] tracking-wider text-ink">
                    {region.name}
                    <span aria-hidden className="h-px flex-1 bg-line" />
                  </h3>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
                    {items.map((p) => (
                      <li key={p.slug}>
                        {p.n > 0 ? (
                          <Link href={`/area/${p.slug}/`} className="chip w-full">
                            {p.name.replace(/[都府県]$/, "")}
                            <span className="chip-count">{p.n.toLocaleString()}</span>
                          </Link>
                        ) : (
                          <span className="chip chip-disabled w-full">
                            {p.name.replace(/[都府県]$/, "")}
                            <span className="chip-count">-</span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {topAreas.length > 0 && (
            <div className="reveal">
              <h3 className="mt-10 mb-3 text-muted">掲載件数の多い市区町村</h3>
              <ul className="flex flex-wrap gap-2">
                {topAreas.map((a) => (
                  <li key={`${a.pref_slug}-${a.city_slug}`}>
                    <Link href={`/area/${seg(a.pref_slug)}/${seg(a.city_slug)}/`} className="chip">
                      {a.prefecture}{a.city}
                      <span className="chip-count">{a.facility_count.toLocaleString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-6">
            <Link href="/area/" className="btn-secondary">都道府県一覧 →</Link>
          </p>
        </section>
      )}

      {/* =====================================================================
          03 3つの入口
          ===================================================================== */}
      <section className="mt-16 md:mt-20">
        <div className="mb-6 border-t border-line-strong pt-8 md:pt-10">
          <h2>3つの検索方法</h2>
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
          {ENTRANCES.map((e) => (
            <li key={e.href} className="reveal">
              <Link href={e.href} className="card card-link flex h-full flex-col p-6 md:p-7">
                <Icon name={e.icon} size={64} />
                <span className="mt-5 text-base font-bold leading-snug">{e.title}</span>
                <span className="mt-2 flex-1 text-[13px] leading-relaxed text-muted">{e.body}</span>
                <span className="mt-5 border-t border-line pt-4 text-[13px] font-bold tracking-wider text-accent">{e.cta} →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* =====================================================================
          04 このデータベースの規模（実績バッジではなく、数えた事実）
          ===================================================================== */}
      {total > 0 && (
        <section className="reveal mt-12">
          <dl className="grid grid-cols-2 gap-px border border-line-strong bg-line-strong lg:grid-cols-4">
            <StatCard label="掲載施設数" value={total.toLocaleString()} unit="件" note="特養・老健・グループホーム・有料老人ホーム" />
            <StatCard label="掲載市区町村数" value={stats.cities.toLocaleString()} unit="市区町村" note={`うち3件以上の市区町村は${stats.cities3.toLocaleString()}`} />
            <StatCard label="運営法人数" value={stats.corporations.toLocaleString()} unit="法人" note="法人番号（13桁）で同一法人を判定した数" />
            <StatCard label="データ取得日" value={meta.acquired_on ?? "-"} note={meta.imported_at ? `取り込み ${meta.imported_at}` : undefined} />
          </dl>
        </section>
      )}

      {/* =====================================================================
          05 種別から探す
          ===================================================================== */}
      {types.length > 0 && (
        <section className="mt-16 md:mt-20">
          <SectionHeading
            icon="type"
            title="サービス種別から探す"
            lead="当サイトの掲載対象は、住まいとして利用する入居系の4種別です。入居条件や費用の仕組みは種別ごとに異なります。"
          />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...residential, ...otherTypes].map((t) => {
              const g = TYPE_GUIDES[t.service_type_slug];
              return (
                <li key={t.service_type_slug} className="reveal">
                  <Link
                    href={`/type/${seg(t.service_type_slug)}/`}
                    className="card card-link flex h-full flex-col p-6"
                  >
                    {g && <Icon name={g.icon} size={64} />}
                    <span className="mt-4 mb-5 text-sm font-bold leading-snug">{g?.short ?? t.service_type}</span>
                    <span className="mt-auto border-t border-line pt-4 font-display text-[1.75rem] leading-none tabular-nums text-ink">
                      {t.facility_count.toLocaleString()}
                      <span className="ml-1 font-sans text-xs text-muted">件</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-2">{TYPE_GUIDE_CAVEAT}</p>
        </section>
      )}

      {/* =====================================================================
          06 運営法人から探す（このサイトの主役）
          ===================================================================== */}
      {topCorps.length > 0 && (
        <section className="mt-16 md:mt-20">
          <SectionHeading
            icon="hojin"
            title="運営法人から探す"
            lead="運営方針や人員配置は、運営法人ごとに異なります。法人の同一性は法人名ではなく法人番号（13桁）で判定しているため、「社会福祉法人札幌慈啓会」と「社会福祉法人　札幌慈啓会」のような表記の違いがあっても、同一の法人として集計しています。"
          />
          <div className="card reveal overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <caption className="sr-only">掲載施設数の多い運営法人 上位{topCorps.length}法人</caption>
              <thead>
                <tr className="border-b border-line-strong text-left text-xs text-muted">
                  <th scope="col" className="w-12 py-3 pl-4 pr-2 text-right font-medium">#</th>
                  <th scope="col" className="py-3 pr-3 font-medium">運営法人</th>
                  <th scope="col" className="w-24 py-3 pr-3 text-right font-medium">施設数</th>
                  <th scope="col" className="w-28 py-3 pr-4 text-right font-medium">展開都道府県</th>
                </tr>
              </thead>
              <tbody>
                {topCorps.map((c, i) => (
                  <tr key={c.slug} className="border-b border-line last:border-0 hover:bg-tint">
                    <td className="py-3 pl-4 pr-2 text-right tabular-nums text-muted-2">{i + 1}</td>
                    <td className="py-3 pr-3">
                      <Link href={`/hojin/${seg(c.slug)}/`} className="font-medium text-ink underline-offset-4 hover:text-accent hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums">{c.facility_count.toLocaleString()}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-muted">{c.pref_count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            掲載している{stats.corporations.toLocaleString()}法人のうち、施設数の多い{topCorps.length}法人です。
            件数は当サイトに掲載している4種別（特養・老健・グループホーム・有料老人ホーム）の範囲での数であり、法人の規模を示すものではありません。
            全法人は{" "}
            <Link href="/hojin/" className="text-accent hover:underline">運営法人一覧</Link>
            {" "}からご確認いただけます。
          </p>
        </section>
      )}

      {/* =====================================================================
          07 ファクト別の並べ替え
          ===================================================================== */}
      <section className="mt-16 md:mt-20">
        <SectionHeading
          icon="sort"
          title="公表データの項目別の並べ替え"
          lead="公表データの単一の項目の値にもとづいて並べ替えた一覧です。複数の項目を重み付けして合成した総合ランキングや、おすすめ順・★評価は作成していません。"
        />
        <p className="note reveal mb-4 px-5 py-4 text-sm font-bold">{NOT_A_RECOMMENDATION}</p>
        <ul className="grid gap-4 sm:grid-cols-2">
          {RANKING_AXES.map((a) =>
            // 距離の軸はこのページの検索フォームそのもの。自分自身へのリンクは張らない。
            a.href === "/" ? (
              <li key={a.href} className="reveal border border-dashed border-line-strong px-5 py-5">
                <span className="text-sm font-bold text-ink">{a.label}</span>
                <span className="mt-1.5 block text-xs leading-relaxed text-muted">
                  {a.basis}このページ上部の検索フォームで、この順序による検索ができます。
                </span>
              </li>
            ) : (
              <li key={a.href} className="reveal">
                <Link href={a.href} className="card card-link block h-full px-5 py-5">
                  <span className="text-sm font-bold text-accent">{a.label}</span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-muted">{a.basis}</span>
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
        <section className="mt-16 md:mt-20">
          <SectionHeading
            icon="data"
            title="当サイトの掲載データについて"
            lead="項目ごとの記載の割合（充足率）を公開しています。記載のない項目は推測で補完せず、「記載なし」と表示しています。"
          />
          <div className="card reveal overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left text-xs text-muted">
                  <th scope="col" className="py-3 pl-4 pr-3 font-medium">項目</th>
                  <th scope="col" className="w-28 py-3 pr-3 text-right font-medium">記載あり</th>
                  <th scope="col" className="w-20 py-3 pr-4 text-right font-medium">充足率</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["緯度・経度（距離検索に使用）", stats.withGeo],
                  ["法人番号（法人ページの同一法人判定に使用）", covCorpNo],
                  ["公式URL", covUrl],
                  ["定員（1人以上の記載）", covCapacity],
                ].map(([label, n]) => (
                  <tr key={label as string} className="border-b border-line last:border-0">
                    <td className="py-3 pl-4 pr-3">{label as string}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{(n as number).toLocaleString()}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{pct(n as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6">
            <Link href="/data/" className="btn-secondary">全項目の充足率と掲載方針 →</Link>
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
