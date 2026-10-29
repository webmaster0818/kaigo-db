// トップのファーストビュー画像。
// 写真に差し替えるときは HERO の src・width・height だけを直す（枠の比率は width/height から決まる。
// 角丸なし・左端（スマホは下端）を地色に溶かす処理は globals.css の .hero-visual）。
const HERO = {
  src: "/img/hero.webp",
  width: 1100,
  height: 613,
};

export default function HeroVisual() {
  return (
    <div className="hero-visual" style={{ aspectRatio: `${HERO.width} / ${HERO.height}` }}>
      {/* 装飾用。施設や入居者の実写ではない */}
      <img src={HERO.src} alt="" aria-hidden width={HERO.width} height={HERO.height} fetchPriority="high" />
    </div>
  );
}
