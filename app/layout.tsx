import type { Metadata } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// 注意: ここに alternates.canonical を書かないこと。
// 全ページが '/' を指してしまう事故が起きるため、canonical は各ページで自己参照を設定する。
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}｜全国の介護施設・事業所データベース`,
    template: `%s｜${SITE_NAME}`,
  },
  description:
    "厚生労働省「介護サービス情報公表システム」の公表データを、現在地からの距離・市区町村・サービス種別・運営法人で検索できるデータベースです。口コミや独自評価は掲載していません。",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: SITE_NAME,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
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
