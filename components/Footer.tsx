import Link from "next/link";
import { LICENSE_NAME, LICENSE_URL, SITE_NAME, SOURCE_NAME, SOURCE_URL } from "@/lib/site";

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-line-strong bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-12 text-xs text-muted">
        <ul className="flex flex-wrap gap-x-6 gap-y-3 text-[13px]">
          <li><Link href="/" className="underline-offset-4 hover:text-ink hover:underline">トップ</Link></li>
          <li><Link href="/type/" className="underline-offset-4 hover:text-ink hover:underline">サービス種別一覧</Link></li>
          <li><Link href="/area/" className="underline-offset-4 hover:text-ink hover:underline">都道府県一覧</Link></li>
          <li><Link href="/hojin/" className="underline-offset-4 hover:text-ink hover:underline">運営法人一覧</Link></li>
          <li><Link href="/ranking/" className="underline-offset-4 hover:text-ink hover:underline">並べ替えて探す</Link></li>
          <li><Link href="/data/" className="underline-offset-4 hover:text-ink hover:underline">データについて（充足率）</Link></li>
        </ul>
        <p className="mt-8 max-w-3xl border-t border-line pt-6 leading-relaxed">
          掲載情報は{" "}
          <a href={SOURCE_URL} rel="noopener noreferrer" target="_blank" className="underline hover:text-accent">
            {SOURCE_NAME}
          </a>{" "}
          の公表データ（
          <a href={LICENSE_URL} rel="license noopener noreferrer" target="_blank" className="underline hover:text-accent">
            {LICENSE_NAME}
          </a>
          ）にもとづいています。口コミ・独自の評価・ランキングは掲載していません。
          ご利用前に、各施設に最新の状況をご確認ください。
        </p>
        <p className="mt-4 tracking-wider text-muted-2">© {new Date().getFullYear()} {SITE_NAME}</p>
      </div>
    </footer>
  );
}
