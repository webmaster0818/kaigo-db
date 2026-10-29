// トップのファーストビュー画像。
// 2026-10 時点では表示しない（見出しの直後に検索フォームを置くため・イラストの品質のため）。
// 写真に差し替えるときは HERO.src にパスを入れ、width・height を写真に合わせる（枠の比率は width/height から決まる。
// 角丸なし・左端（スマホは下端）を地色に溶かす処理は globals.css の .hero-visual）。
// 置き場所は app/page.tsx の h1 の直後（検索フォームの前）。2カラムにする場合はそこで grid に包む。
const HERO: { src: string | null; width: number; height: number } = {
  src: null, // 例: "/img/hero-photo.webp"
  width: 1100,
  height: 613,
};

export default function HeroVisual() {
  if (!HERO.src) return null;
  return (
    <div className="hero-visual" style={{ aspectRatio: `${HERO.width} / ${HERO.height}` }}>
      {/* 装飾用。施設や入居者の実写ではない */}
      <img src={HERO.src} alt="" aria-hidden width={HERO.width} height={HERO.height} fetchPriority="high" />
    </div>
  );
}
