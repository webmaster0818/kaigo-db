// 線画アイコン（墨色・単色）。
// - 48×48 の格子に、線幅 1.5 の線だけで描く（塗りなし・角は丸め）。色は currentColor（.icon で墨色）。
// - 画像生成で作ったカラーのアイコン（public/img/icon-*.webp・type-*.webp）は使わない。

export type IconName =
  | "distance"
  | "type"
  | "hojin"
  | "area"
  | "data"
  | "sort"
  | "tokuyo"
  | "roken"
  | "group-home"
  | "yuryo";

const PATHS: Record<IconName, string> = {
  // 住所・現在地から：ピン＋足もとの距離の輪
  distance:
    '<path d="M24 37s-10-9.6-10-17.5a10 10 0 0 1 20 0C34 27.4 24 37 24 37Z"/><circle cx="24" cy="19.5" r="3.5"/>' +
    '<path d="M15 34.5c-4.3 1-7 2.6-7 4.5 0 3.3 7.2 6 16 6s16-2.7 16-6c0-1.9-2.7-3.5-7-4.5"/>',
  // サービス種別：家
  type:
    '<path d="M6 22 24 8l18 14"/><path d="M11 18.5V40h26V18.5"/><path d="M20.5 40v-9.5h7V40"/><path d="M6 40h36"/>',
  // 運営法人：大小の建物
  hojin:
    '<path d="M9 40V9h18v31"/><path d="M27 18h12v22"/><path d="M5 40h38"/>' +
    '<path d="M14 15h3M19 15h3M14 21h3M19 21h3M14 27h3M19 27h3M32 24h3M32 30h3"/><path d="M15.5 40v-6h5v6"/>',
  // エリア：折りたたんだ地図
  area:
    '<path d="M6 12.5 17 8l14 4.5L42 8v27.5L31 40l-14-4.5L6 40Z"/><path d="M17 8v27.5M31 12.5V40"/>',
  // データ：表と棒グラフ
  data:
    '<rect x="8" y="7" width="32" height="34"/><path d="M8 15h32"/><path d="M16 34v-8M24 34V21M32 34v-5"/>',
  // 並べ替え：上下の矢印と横線
  sort:
    '<path d="M15 9v30M9 15l6-6 6 6"/><path d="M33 39V9M27 33l6 6 6-6"/>',
  // 特養：家の中のベッド（長く暮らす住まい）
  tokuyo:
    '<path d="M5 21 24 7l19 14"/><path d="M9.5 18v22h29V18"/><path d="M14 37v-9h20v9"/><path d="M14 32.5h20"/><path d="M16.5 28v-3h5v3"/>',
  // 老健：家と十字（医師の配置・リハビリ）
  roken:
    '<path d="M5 21 24 7l19 14"/><path d="M9.5 18v22h29V18"/><path d="M24 23v12M18 29h12"/>',
  // グループホーム：屋根の下の少人数
  "group-home":
    '<path d="M5 21 24 7l19 14"/><path d="M9.5 18v22h29V18"/>' +
    '<circle cx="19" cy="25" r="3"/><circle cx="29" cy="25" r="3"/><path d="M13.5 40c0-5 2.5-8 5.5-8s5.5 3 5.5 8M23.5 40c0-5 2.5-8 5.5-8s5.5 3 5.5 8"/>',
  // 有料老人ホーム：集合住宅
  yuryo:
    '<path d="M11 40V10h26v30"/><path d="M6 40h36"/><path d="M8 10h32"/>' +
    '<path d="M16 16h4M28 16h4M16 22h4M28 22h4M16 28h4M28 28h4"/><path d="M21 40v-7h6v7"/>',
};

export default function Icon({ name, size = 48, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ? `icon ${className}` : "icon"}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
