// 国土地理院の地理院タイル（淡色地図）で、施設の場所の地図を HTML 文字列として組み立てる。
// 規約（https://maps.gsi.go.jp/development/ichiran.html・2026-11-03 確認）：
//   ウェブサイトでリアルタイムに読み込んで使う場合は、出典の明示のみで申請不要。
//   出典は「国土地理院」または「地理院タイル」等と書き、地理院タイル一覧ページへリンクする。
// タイルは国土地理院から直接読み込む（保存・再配布しない）。React 側・直接描画（lib/direct.ts）の両方から使う。
import { isValidJapanLatLng } from "./geo";

const TILE = "https://cyberjapandata.gsi.go.jp/xyz/pale";
export const GSI_LIST_URL = "https://maps.gsi.go.jp/development/ichiran.html";

/** 地図の下に置く出典表示 */
export const GSI_CREDIT_HTML =
  `<p class="gsimap-credit">地図：<a href="${GSI_LIST_URL}" target="_blank" rel="noopener">地理院タイル</a>（国土地理院）</p>`;

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** 地図を出す範囲。okina 指示（2026-11-04）で、まず世田谷区の一覧と施設詳細ページだけに出す */
export function mapEnabled(f: { prefecture?: string | null; city?: string | null }): boolean {
  return f.prefecture === "東京都" && f.city === "世田谷区";
}

// しずく形のピン（先端が施設の位置）。地図の線や文字にまぎれないよう、地図は淡くしてピンだけ色を付ける（案C・okina 選定 2026-11-04）
const PIN_SVG =
  `<svg class="gsimap-pin" viewBox="0 0 32 44" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 43 16 43s15-16 15-27.2C31 7.6 24.3 1 16 1z" fill="currentColor" stroke="#fff" stroke-width="2"/><circle cx="16" cy="15.5" r="5.5" fill="#fff"/></svg>`;

/**
 * 施設の位置を中心にした地図。
 * w×h は地図そのものの大きさ（px）。外枠（cls で指定）はこれより小さくてよく、中央で切り取って表示する。
 */
export function gsiMapHtml(
  lat: number | null,
  lng: number | null,
  opt: { w: number; h: number; z: number; cls: string; label: string; bubble?: { name: string; address?: string | null } },
): string {
  if (!isValidJapanLatLng(lat, lng)) return `<div class="${opt.cls} gsimap gsimap--none" aria-hidden="true"></div>`;
  const { w, h, z } = opt;
  const n = 2 ** z * 256;
  const px = ((lng! + 180) / 360) * n;
  const r = (lat! * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const left = px - w / 2;
  const top = py - h / 2;
  let tiles = "";
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w - 1) / 256); tx++) {
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h - 1) / 256); ty++) {
      tiles +=
        `<img src="${TILE}/${z}/${tx}/${ty}.png" alt="" loading="lazy" decoding="async" width="256" height="256" ` +
        `style="left:${Math.round(tx * 256 - left)}px;top:${Math.round(ty * 256 - top)}px">`;
    }
  }
  return (
    `<div class="${opt.cls} gsimap" role="img" aria-label="${attr(opt.label)}">` +
    `<div class="gsimap-inner" style="width:${w}px;height:${h}px;margin-left:-${w / 2}px;margin-top:-${h / 2}px">${tiles}</div>` +
    `<span class="gsimap-shadow" aria-hidden="true"></span>${PIN_SVG}` +
    (opt.bubble
      ? `<span class="gsimap-ring" aria-hidden="true"></span>` +
        `<div class="gsimap-bubble" aria-hidden="true"><b>${attr(opt.bubble.name)}</b>` +
        (opt.bubble.address ? `<small>${attr(opt.bubble.address)}</small>` : "") +
        `</div>` +
        // 国土地理院の地図（拡大・移動できる。無料）で同じ地点を開く
        `<a class="gsimap-open" href="https://maps.gsi.go.jp/#${z}/${lat!.toFixed(6)}/${lng!.toFixed(6)}/" target="_blank" rel="noopener">大きな地図で見る（地理院地図）</a>`
      : "") +
    `</div>`
  );
}

/** 一覧用の小さな地図 */
export const thumbMap = (lat: number | null, lng: number | null, name: string) =>
  gsiMapHtml(lat, lng, { w: 160, h: 120, z: 15, cls: "gsimap--thumb", label: `${name}の所在地の地図` });

/** 詳細ページ用の横長の地図 */
export const detailMap = (lat: number | null, lng: number | null, name: string, address?: string | null) =>
  gsiMapHtml(lat, lng, { w: 1200, h: 440, z: 16, cls: "gsimap--detail", label: `${name}の所在地の地図`, bubble: { name, address } });
