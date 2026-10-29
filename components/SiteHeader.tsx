import Link from "next/link";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

const NAV = [
  { href: "/", label: "住所から探す" },
  { href: "/type/", label: "サービス種別" },
  { href: "/area/", label: "エリア" },
  { href: "/hojin/", label: "運営法人" },
  { href: "/ranking/", label: "並べ替えて探す" },
  { href: "/data/", label: "データについて" },
];

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line-strong bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:py-4">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="font-display text-xl font-bold tracking-wider text-ink">{SITE_NAME}</span>
          <span className="text-[11px] tracking-wider text-muted">{SITE_TAGLINE}</span>
        </Link>
        <nav className="-mx-4 w-full overflow-x-auto px-4 md:mx-0 md:ml-auto md:w-auto md:px-0">
          <ul className="flex gap-x-5 whitespace-nowrap text-[13px] md:flex-wrap">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="text-muted underline-offset-4 hover:text-ink hover:underline">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
