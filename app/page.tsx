import Link from "next/link";
import type { Metadata } from "next";
import { queries, type PlaceHit } from "@/lib/db";
import { isValidJapanLatLng } from "@/lib/geo";
import { PREF_ORDER, PREF_SLUGS } from "@/lib/slug";
import { REGIONS } from "@/lib/regions";
import TOP_CITIES_JSON from "@/lib/areaTopCities.generated.json";
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

/** エリアタブの都道府県ごとの主な市区町村（scripts/gen-addr-index.ts が area テーブルの施設数上位から作る） */
const TOP_CITIES = TOP_CITIES_JSON as Record<string, Array<{ city: string; city_slug: string }>>;

/** エリアタブで大きく出す都道府県（掲載件数の多い大都市圏） */
const MAJOR_PREFS = ["北海道", "東京都", "神奈川県", "愛知県", "大阪府", "福岡県"];

/** エリアタブの地方の行。中国と四国は1行にまとめる */
const AREA_ROWS = REGIONS.reduce<Array<{ name: string; prefs: string[] }>>((rows, r) => {
  const last = rows[rows.length - 1];
  if (r.name === "四国" && last?.name === "中国") {
    rows[rows.length - 1] = { name: "中国・四国", prefs: [...last.prefs, ...r.prefs] };
  } else rows.push({ name: r.name, prefs: [...r.prefs] });
  return rows;
}, []);

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

  const [meta, stats, types, prefs, topCorps] = await Promise.all([
    queries.meta(),
    queries.siteStats(),
    queries.typeCounts(),
    queries.prefectures(),
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
          01 ファーストビュー（見出し → すぐ検索フォーム）
          サイトの説明文（「記載なし」・推測で補完しない・口コミ等を載せない）は 08 の掲載データの節に移した。
          ===================================================================== */}
      <section className="pt-1 md:pt-4">
        <h1 className="mb-4 text-[1.6rem] leading-[1.4] md:mb-6 md:text-[2.5rem]">
          公表データにもとづく
          <br />
          介護施設の検索
        </h1>
        {/* 写真に差し替えるときは components/HeroVisual.tsx の HERO.src を設定する（今は何も表示しない） */}
        <HeroVisual />

        <div id="search" className="scroll-mt-24">
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
          02 探し方のタブ（エリアから探す／ランキングから探す／条件から探す）
          ラジオボタン＋CSS で切り替える（JS 不要）。3つのパネルはすべて HTML に含まれる（リンクはクローラーにも見える）。
          住所から探すは上の検索フォームが担うのでタブには入れない。
          ===================================================================== */}
      <section id="find" className="mt-16 scroll-mt-24 md:mt-20">
        <div className="tabs">
          <input type="radio" name="find-tab" id="tab-area" className="tab-input sr-only" defaultChecked />
          <input type="radio" name="find-tab" id="tab-rank" className="tab-input sr-only" />
          <input type="radio" name="find-tab" id="tab-cond" className="tab-input sr-only" />
          <div className="tab-list">
            <label htmlFor="tab-area" className="tab tab-area">
              <Icon name="area" size={28} />
              エリアから探す
            </label>
            <label htmlFor="tab-rank" className="tab tab-rank">
              <Icon name="sort" size={28} />
              ランキングから探す
            </label>
            <label htmlFor="tab-cond" className="tab tab-cond">
              <Icon name="type" size={28} />
              条件から探す
            </label>
          </div>

          <div className="tab-panels">
            {/* ---- エリアから探す ---- */}
            <div id="area" className="tab-panel panel-area">
              <h2 className="sr-only">エリアから探す</h2>
              {prefs.length > 0 && (
                <>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {MAJOR_PREFS.map((name) => {
                      const slug = PREF_SLUGS[name];
                      const n = Number(prefBySlug.get(slug)?.facility_count ?? 0);
                      return (
                        <li key={slug}>
                          <Link href={`/area/${slug}/`} className="pref-card">
                            {/* 写真を入れるときは、ここに <span className="pref-media"><img …/></span> を置く（.pref-media の CSS は用意済み） */}
                            <span className="pref-glyph" aria-hidden>{name.replace(/[都府県]$/, "")}</span>
                            <span className="pref-body card">
                              <span className="pref-name">{name}</span>
                              <span className="pref-count">
                                {n > 0 ? n.toLocaleString() : "-"}
                                <span className="ml-0.5 text-[11px] text-muted">件</span>
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="card mt-6">
                    {AREA_ROWS.map((row) => (
                      <div key={row.name} className="area-row">
                        <h3 className="area-row-name">{row.name}</h3>
                        <ul className="area-row-prefs">
                          {row.prefs.map((name) => {
                            const slug = PREF_SLUGS[name];
                            const n = Number(prefBySlug.get(slug)?.facility_count ?? 0);
                            const cities = n > 0 ? TOP_CITIES[slug] ?? [] : [];
                            return (
                              <li key={slug}>
                                {n > 0 ? (
                                  <Link href={`/area/${slug}/`} className="font-bold text-ink underline-offset-4 hover:text-accent hover:underline">
                                    {name}
                                  </Link>
                                ) : (
                                  <span className="font-bold text-muted-2">{name}</span>
                                )}
                                {cities.length > 0 && (
                                  <span className="text-muted">
                                    （
                                    {cities.map((c, i) => (
                                      <span key={c.city_slug}>
                                        {i > 0 && "、"}
                                        <Link
                                          href={`/area/${slug}/${seg(c.city_slug)}/`}
                                          className="underline-offset-4 hover:text-accent hover:underline"
                                        >
                                          {c.city}
                                        </Link>
                                      </span>
                                    ))}
                                    ）
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <p className="mt-6">
                <Link href="/area/" className="btn-secondary">都道府県一覧 →</Link>
              </p>
            </div>

            {/* ---- ランキングから探す（公表データの項目別の並べ替え。文言は lib/ranking.ts のまま） ---- */}
            <div id="ranking" className="tab-panel panel-rank">
              <h2 className="sr-only">ランキングから探す</h2>
              <h3 className="text-base">公表データの項目別の並べ替え</h3>
              <p className="mt-2 mb-5 max-w-3xl text-sm leading-relaxed text-muted">
                公表データの単一の項目の値にもとづいて並べ替えた一覧です。複数の項目を重み付けして合成した総合ランキングや、おすすめ順・★評価は作成していません。
              </p>
              <p className="note mb-4 px-5 py-4 text-sm font-bold">{NOT_A_RECOMMENDATION}</p>
              <ul className="grid gap-4 sm:grid-cols-2">
                {RANKING_AXES.map((a) =>
                  // 距離の軸はこのページの検索フォームそのもの。自分自身へのリンクは張らない。
                  a.href === "/" ? (
                    <li key={a.href} className="border border-dashed border-line-strong px-5 py-5">
                      <span className="text-sm font-bold text-ink">{a.label}</span>
                      <span className="mt-1.5 block text-xs leading-relaxed text-muted">
                        {a.basis}このページ上部の検索フォームで、この順序による検索ができます。
                      </span>
                    </li>
                  ) : (
                    <li key={a.href}>
                      <Link href={a.href} className="card card-link block h-full px-5 py-5">
                        <span className="text-sm font-bold text-accent">{a.label}</span>
                        <span className="mt-1.5 block text-xs leading-relaxed text-muted">{a.basis}</span>
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>

            {/* ---- 条件から探す（既存のページ・クエリで表せる条件だけ） ---- */}
            <div id="conditions" className="tab-panel panel-cond">
              <h2 className="sr-only">条件から探す</h2>
              <h3 className="text-base">サービス種別から探す</h3>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {types.map((t) => (
                  <li key={t.service_type_slug}>
                    <Link href={`/type/${seg(t.service_type_slug)}/`} className="chip w-full">
                      {TYPE_GUIDES[t.service_type_slug]?.short ?? t.service_type}
                      <span className="chip-count">{t.facility_count.toLocaleString()}件</span>
                    </Link>
                  </li>
                ))}
              </ul>

              <h3 className="mt-8 text-base">都道府県とサービス種別で絞り込む</h3>
              <form method="get" action="/ranking/capacity/" className="card mt-3 p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="font-bold tracking-wider text-ink">都道府県</span>
                    <select name="pref" defaultValue="" className="field mt-1.5">
                      <option value="">すべて</option>
                      {PREF_ORDER.map((name) => (
                        <option key={PREF_SLUGS[name]} value={PREF_SLUGS[name]}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs">
                    <span className="font-bold tracking-wider text-ink">サービス種別</span>
                    <select name="type" defaultValue="" className="field mt-1.5">
                      <option value="">すべて</option>
                      {types.map((t) => (
                        <option key={t.service_type_slug} value={t.service_type_slug}>{t.service_type}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="submit" className="btn-primary w-full sm:w-auto">施設を定員が多い順に表示</button>
                  <button type="submit" formAction="/ranking/hojin-scale/" className="btn-secondary w-full sm:w-auto">
                    運営法人を施設数が多い順に表示
                  </button>
                </div>
                <p className="mt-4 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
                  {NOT_A_RECOMMENDATION}定員順の一覧は、公表データに定員の記載がある施設のみを対象にしています。
                  距離と種別で探す場合は、上の検索フォームで「サービス種別」を選んでください。
                </p>
              </form>
            </div>
          </div>
        </div>
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
          08 このサイトのデータについて
          ===================================================================== */}
      {total > 0 && (
        <section className="mt-16 md:mt-20">
          <SectionHeading
            icon="data"
            title="当サイトの掲載データについて"
            lead="項目ごとの記載の割合（充足率）を公開しています。記載のない項目は推測で補完せず、「記載なし」と表示しています。"
          />
          {/* 旧ファーストビューの説明文（文言はそのまま） */}
          <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted">
            全国{total > 0 ? total.toLocaleString() : ""}件の介護施設を、住所からの距離・市区町村・サービス種別・運営法人で検索できるデータベースです。
            公表データに記載のない項目は「記載なし」と表示し、推測による補完は行っていません。口コミ・独自の★評価・おすすめ順は掲載していません。
          </p>
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
