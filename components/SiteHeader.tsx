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
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-accent">{SITE_NAME}</span>
          <span className="text-[11px] font-normal text-muted">{SITE_TAGLINE}</span>
        </Link>
        <nav className="ml-auto">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="text-muted hover:text-accent hover:underline">
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
