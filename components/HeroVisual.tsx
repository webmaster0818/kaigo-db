import type { ReactNode } from "react";

// トップのファーストビュー。写真を画面の横幅いっぱいに敷き、左側に見出し、下側に検索フォームを重ねる（okina 指示 2026-11-04）。
// 写真：ぱくたそ（https://www.pakutaso.com/）のフリー素材。okina 選定（2026-11-03）。
// 規約（https://www.pakutaso.com/userpolicy.html・2026-11-03 確認）：商用利用可・クレジット不要・直リンク禁止（自サイトに置いて配信）。
// 実在の施設の職員と誤解されないよう、写真の隅に「写真はイメージです」を入れる。
const HERO = { src: "/img/hero-photo.webp", srcSp: "/img/hero-photo-sp.webp", width: 1600, height: 1066 };

export default function HeroVisual({ children, search }: { children: ReactNode; search?: ReactNode }) {
  return (
    <div className="hero-visual">
      {/* 写真と左側のぼかしだけを枠で切り抜く（検索候補の一覧が写真の外へはみ出せるよう、外枠は切り抜かない） */}
      <div className="hero-visual__photo" aria-hidden>
        <picture>
          <source media="(max-width: 767px)" srcSet={HERO.srcSp} />
          <img src={HERO.src} alt="" width={HERO.width} height={HERO.height} fetchPriority="high" />
        </picture>
        <span className="hero-visual__note">写真はイメージです</span>
      </div>
      <div className="hero-visual__inner">
        <div className="hero-visual__text">{children}</div>
        {search && <div className="hero-visual__search">{search}</div>}
      </div>
    </div>
  );
}
