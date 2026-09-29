import Link from "next/link";
import { LICENSE_NAME, LICENSE_URL, SITE_NAME, SOURCE_NAME, SOURCE_URL } from "@/lib/site";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-8 text-xs text-muted">
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <li><Link href="/" className="hover:text-accent hover:underline">トップ</Link></li>
          <li><Link href="/type/" className="hover:text-accent hover:underline">サービス種別一覧</Link></li>
          <li><Link href="/area/" className="hover:text-accent hover:underline">都道府県一覧</Link></li>
          <li><Link href="/hojin/" className="hover:text-accent hover:underline">運営法人一覧</Link></li>
          <li><Link href="/ranking/" className="hover:text-accent hover:underline">並べ替えて探す</Link></li>
          <li><Link href="/data/" className="hover:text-accent hover:underline">データについて（充足率）</Link></li>
        </ul>
        <p className="mt-5 leading-relaxed">
          掲載情報は{" "}
          <a href={SOURCE_URL} rel="noopener noreferrer" target="_blank" className="underline hover:text-accent">
            {SOURCE_NAME}
          </a>{" "}
          の公表データ（
          <a href={LICENSE_URL} rel="license noopener noreferrer" target="_blank" className="underline hover:text-accent">
            {LICENSE_NAME}
          </a>
          ）に基づきます。口コミ・独自評価・ランキングは掲載していません。
          最新の状況は各事業所へ直接ご確認ください。
        </p>
        <p className="mt-3 text-muted-2">© {new Date().getFullYear()} {SITE_NAME}</p>
      </div>
    </footer>
  );
}
