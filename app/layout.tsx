import type { Metadata } from "next";
import { Montserrat, Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// 書体：和文は Noto Sans JP、欧文・数字は Montserrat（caresul-kaigo.jp に倣う）。next/font で自己ホストし、
// 代替フォントの寸法を合わせてレイアウトのずれを抑える。和文は字数が多く分割配信になるため先読みしない。
// 施設・法人ページ（lib/direct.ts）は <html> の class を scripts/gen-direct-shell.mjs で取り出して同じものを付ける。
const notoSansJp = Noto_Sans_JP({
  // 可変フォント1組（400〜700）で全ウェイトをまかなう（固定ウェイトを3つ持つより転送量が少ない）
  weight: "variable",
  display: "swap",
  preload: false,
  variable: "--font-noto",
});
const montserrat = Montserrat({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-montserrat",
});

// 注意: ここに alternates.canonical を書かないこと。
// 全ページが '/' を指してしまう事故が起きるため、canonical は各ページで自己参照を設定する。
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}｜全国の介護施設・事業所データベース`,
    template: `%s｜${SITE_NAME}`,
  },
  description:
    "厚生労働省「介護サービス情報公表システム」の公表データにもとづき、現在地からの距離・市区町村・サービス種別・運営法人で介護施設を検索できるデータベースです。口コミや独自の評価は掲載していません。",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: SITE_NAME,
    // サイト共通の既定OG画像（数字は入れていない）。ページ側で openGraph を書く場合は images も渡すこと
    images: [{ url: "/og-default.png?v=20261014", width: 1200, height: 630, alt: `${SITE_NAME}｜全国の介護施設・事業所データベース` }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-default.png?v=20261014"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${notoSansJp.variable} ${montserrat.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE_NAME,
              url: SITE_URL,
              inLanguage: "ja",
            }),
          }}
        />
        <SiteHeader />
        <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
