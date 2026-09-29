import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queries, type Facility } from "@/lib/db";
import { isValidJapanLatLng } from "@/lib/geo";
import { facilityRobots, isIndexableFacility } from "@/lib/indexing";
import { abs, decodeParam, NO_DATA, orNoData, seg } from "@/lib/site";
import Breadcrumb from "@/components/Breadcrumb";
import FacilityTable from "@/components/FacilityTable";
import SourceNote from "@/components/SourceNote";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id: idRaw } = await params;
  const f = await queries.facilityById(decodeParam(idRaw));
  if (!f) return { title: "施設が見つかりません", robots: { index: false, follow: true } };
  const where = [f.prefecture, f.city].filter(Boolean).join("");
  return {
    title: `${f.name}（${where}）｜${f.service_type}`,
    description: `${where}の${f.service_type}「${f.name}」の公表情報。住所・電話番号・運営法人${f.capacity != null ? `・定員${f.capacity}人` : ""}を厚生労働省のデータから掲載しています。`,
    alternates: { canonical: abs(`/facility/${seg(f.id)}/`) },
    // 公式URLも定員も無い薄いページは noindex（lib/indexing.ts の判定を共有）
    robots: facilityRobots(f),
  };
}

/** 施設の構造化データ。LocalBusiness は使わず Place + 運営法人の Organization にとどめる。 */
function facilityJsonLd(f: Facility) {
  const hasGeo = isValidJapanLatLng(f.lat, f.lng);
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: f.name,
    url: abs(`/facility/${seg(f.id)}/`),
    additionalType: f.service_type,
    identifier: f.jigyosho_no,
  };
  if (f.address || f.prefecture || f.city || f.postal_code) {
    node.address = {
      "@type": "PostalAddress",
      addressCountry: "JP",
      ...(f.prefecture ? { addressRegion: f.prefecture } : {}),
      ...(f.city ? { addressLocality: f.city } : {}),
      ...(f.address ? { streetAddress: f.address } : {}),
      ...(f.postal_code ? { postalCode: f.postal_code } : {}),
    };
  }
  if (hasGeo) node.geo = { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lng };
  if (f.tel) node.telephone = f.tel;
  if (f.official_url) node.sameAs = [f.official_url];
  if (f.capacity != null) node.maximumAttendeeCapacity = f.capacity;
  if (f.corporation_name) {
    node.additionalProperty = [
      { "@type": "PropertyValue", name: "運営法人", value: f.corporation_name },
    ];
  }
  return node;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 border-b border-line py-2 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted sm:pt-0.5">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

const noData = <span className="text-muted-2">{NO_DATA}</span>;

export default async function FacilityPage({ params }: { params: Params }) {
  const { id: idRaw } = await params;
  const f = await queries.facilityById(decodeParam(idRaw));
  if (!f) notFound();

  const meta = await queries.meta();
  const neighbors =
    f.pref_slug && f.city_slug ? await queries.facilitiesInSameCity(f.pref_slug, f.city_slug, f.id, 20) : [];

  const hasGeo = isValidJapanLatLng(f.lat, f.lng);
  const indexable = isIndexableFacility(f);

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(facilityJsonLd(f)) }} />

      <Breadcrumb
        items={[
          { name: "ホーム", href: "/" },
          { name: "都道府県から探す", href: "/area/" },
          ...(f.pref_slug && f.prefecture ? [{ name: f.prefecture, href: `/area/${seg(f.pref_slug)}/` }] : []),
          ...(f.pref_slug && f.city_slug && f.city
            ? [{ name: f.city, href: `/area/${seg(f.pref_slug)}/${seg(f.city_slug)}/` }]
            : []),
          { name: f.name },
        ]}
      />

      <p className="text-xs text-muted">{f.service_type}</p>
      <h1 className="mb-4">{f.name}</h1>

      <dl className="mb-6 border-t border-line">
        <Row label="サービス種別">
          <Link href={`/type/${seg(f.service_type_slug)}/`} className="text-accent hover:underline">
            {f.service_type}
          </Link>
        </Row>
        {/* address は import 時に都道府県・市区町村まで含めた1本の文字列に揃えてある */}
        <Row label="所在地">
          {f.address ? (
            <>
              {f.postal_code ? `〒${f.postal_code} ` : ""}
              {f.address}
            </>
          ) : (
            [f.prefecture, f.city].filter(Boolean).join("") || noData
          )}
        </Row>
        <Row label="電話番号">{f.tel ? <a href={`tel:${f.tel.replace(/[^0-9+]/g, "")}`} className="text-accent hover:underline">{f.tel}</a> : noData}</Row>
        <Row label="定員">{f.capacity != null ? <span className="tabular-nums">{f.capacity}人</span> : noData}</Row>
        <Row label="利用可能曜日">{orNoData(f.open_days) === NO_DATA ? noData : f.open_days}</Row>
        <Row label="運営法人">
          {f.corporation_name ? (
            f.corporation_slug ? (
              <Link href={`/hojin/${seg(f.corporation_slug)}/`} className="text-accent hover:underline">
                {f.corporation_name}
              </Link>
            ) : (
              // 法人番号が無い事業所は法人ページを作らない（別法人を同一視する事故を避けるため）。
              // 法人名は出典の表記をそのまま出す。
              <>
                {f.corporation_name}
                <span className="ml-2 text-[11px] text-muted-2">法人番号の記載がないため法人ページはありません</span>
              </>
            )
          ) : (
            noData
          )}
        </Row>
        <Row label="法人番号">
          {f.corporate_number ? <span className="tabular-nums">{f.corporate_number}</span> : noData}
        </Row>
        <Row label="公式サイト">
          {f.official_url ? (
            <a href={f.official_url} rel="nofollow noopener noreferrer" target="_blank" className="break-all text-accent hover:underline">
              {f.official_url}
            </a>
          ) : (
            noData
          )}
        </Row>
        <Row label="緯度・経度">
          {hasGeo ? (
            <>
              <span className="tabular-nums">{f.lat}, {f.lng}</span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lng}`}
                rel="nofollow noopener noreferrer"
                target="_blank"
                className="ml-3 text-xs text-accent hover:underline"
              >
                地図で見る
              </a>
              <Link
                href={`/?lat=${f.lat}&lng=${f.lng}&radius=3&sort=distance`}
                className="ml-3 text-xs text-accent hover:underline"
              >
                この周辺3kmを検索
              </Link>
            </>
          ) : (
            noData
          )}
        </Row>
        <Row label="事業所番号">{orNoData(f.jigyosho_no) === NO_DATA ? noData : <span className="tabular-nums">{f.jigyosho_no}</span>}</Row>
      </dl>

      {!indexable && (
        <p className="mb-6 rounded border border-line bg-tint px-3 py-2 text-xs text-muted">
          この事業所は公表データに定員・公式URLの記載がないため、掲載項目が限られています
          （当サイトの方針により検索エンジンには登録していません）。
        </p>
      )}

      {neighbors.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3">
            同じ{f.city ?? "市区町村"}の事業所
            <span className="ml-2 text-xs font-normal text-muted">{neighbors.length}件</span>
          </h2>
          <FacilityTable rows={neighbors} hideCity />
          {f.pref_slug && f.city_slug && (
            <p className="mt-3 text-xs">
              <Link href={`/area/${seg(f.pref_slug)}/${seg(f.city_slug)}/`} className="text-accent hover:underline">
                {f.prefecture}{f.city}の一覧をすべて見る →
              </Link>
            </p>
          )}
        </section>
      )}

      <SourceNote acquiredOn={f.acquired_on ?? meta.acquired_on} />
    </main>
  );
}
