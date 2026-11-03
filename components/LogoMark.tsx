// ロゴマーク：2人の腕でハートの形をつくる（2026-11-03 okina 選定・案C）
export default function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="20 34 472 472" className={className} aria-hidden="true">
      <circle cx="256" cy="270" r="230" fill="#FDF1E7" />
      <path d="M256,430 C150,360 110,300 110,250 C110,200 150,170 190,170 C226,170 248,192 256,214" fill="none" stroke="#C0551F" strokeWidth="36" strokeLinecap="round" />
      <path d="M256,430 C362,360 402,300 402,250 C402,200 362,170 322,170 C286,170 264,192 256,214" fill="none" stroke="#4F7C5A" strokeWidth="36" strokeLinecap="round" />
      <circle cx="168" cy="104" r="40" fill="#C0551F" />
      <circle cx="344" cy="110" r="34" fill="#4F7C5A" />
    </svg>
  );
}
