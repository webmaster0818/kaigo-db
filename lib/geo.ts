// 距離計算とD1向けの近傍検索ユーティリティ。
//
// D1(SQLite) には sin/cos/radians が無い前提で組む。したがって近傍検索は
//   1) 緯度経度のバウンディングボックス(BETWEEN)でSQLから粗く絞り込む  ← インデックスが効く
//   2) 取り出した行に対してJS側で Haversine 距離を計算して絞る/並べ替える
// の2段構えにする。

export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

/** 2点間の大円距離(km) */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * 中心点から radiusKm を包含する矩形。
 * 経度幅は緯度によって変わる(高緯度ほど広い)ので cos で補正する。
 * 極付近・日付変更線付近は素直に全周を返して、SQL側で取りこぼさないようにする。
 */
export function boundingBox(center: LatLng, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / 111.32;
  const cos = Math.cos(toRad(center.lat));
  const lngDelta = Math.abs(cos) < 1e-6 ? 180 : radiusKm / (111.32 * Math.abs(cos));

  const minLat = Math.max(-90, center.lat - latDelta);
  const maxLat = Math.min(90, center.lat + latDelta);

  // 日本国内では起きないが、経度が±180をまたぐ場合は全周にフォールバックする
  const wraps = center.lng - lngDelta < -180 || center.lng + lngDelta > 180;
  return {
    minLat,
    maxLat,
    minLng: wraps ? -180 : center.lng - lngDelta,
    maxLng: wraps ? 180 : center.lng + lngDelta,
  };
}

/**
 * バウンディングボックス用の WHERE 句とバインド値。
 * 呼び出し側の SQL に `AND ${clause}` の形で差し込む。
 */
export function bboxWhere(center: LatLng, radiusKm: number): { clause: string; params: number[] } {
  const b = boundingBox(center, radiusKm);
  return {
    clause: "lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
    params: [b.minLat, b.maxLat, b.minLng, b.maxLng],
  };
}

/**
 * SQLから返ってきた矩形内の候補に距離を付け、radiusKm 以内だけを近い順に返す。
 * (矩形は円より広いので、この絞り込みが無いと角の分だけ余分に入る)
 */
export function withinRadius<T extends { lat: number | null; lng: number | null }>(
  rows: T[],
  center: LatLng,
  radiusKm: number,
): Array<T & { distance_km: number }> {
  const out: Array<T & { distance_km: number }> = [];
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const d = haversineKm(center, { lat: r.lat, lng: r.lng });
    if (d <= radiusKm) out.push({ ...r, distance_km: d });
  }
  out.sort((a, b) => a.distance_km - b.distance_km);
  return out;
}

/** 表示用: 1km未満はm、それ以上は小数1桁のkm */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return "記載なし";
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

/** 緯度経度として妥当か（日本国内の想定レンジ + 0,0 の混入を弾く） */
export function isValidJapanLatLng(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= 20 && lat <= 46 && lng >= 122 && lng <= 154;
}
