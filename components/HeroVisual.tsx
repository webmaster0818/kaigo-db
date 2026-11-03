import type { ReactNode } from "react";

// トップのファーストビュー。写真の上（左側の余白）に見出しを重ね、すぐ下に検索フォームを置く。
// 写真：ぱくたそ（https://www.pakutaso.com/）のフリー素材。okina 選定（2026-11-03）。
// 規約（https://www.pakutaso.com/userpolicy.html・2026-11-03 確認）：商用利用可・クレジット不要・直リンク禁止（自サイトに置いて配信）。
// 実在の施設の職員と誤解されないよう、写真の隅に「写真はイメージです」を入れる。
const HERO = { src: "/img/hero-photo.webp", srcSp: "/img/hero-photo-sp.webp", width: 1600, height: 1066 };

export default function HeroVisual({ children }: { children: ReactNode }) {
  return (
    <div className="hero-visual">
      <picture>
        <source media="(max-width: 767px)" srcSet={HERO.srcSp} />
        <img src={HERO.src} alt="" aria-hidden width={HERO.width} height={HERO.height} fetchPriority="high" />
      </picture>
      <div className="hero-visual__text">{children}</div>
      <span className="hero-visual__note">写真はイメージです</span>
    </div>
  );
}
