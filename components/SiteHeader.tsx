import Link from "next/link";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

const NAV = [
  { href: "/", label: "住所から探す" },
  { href: "/type/", label: "サービス種別" },
  { href: "/area/", label: "エリア" },
  { href: "/ranking/", label: "並べ替えて探す" },
  { href: "/data/", label: "データについて" },
];

export default function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight text-ink">
          {SITE_NAME}
          <span className="ml-2 text-[11px] font-normal text-muted">{SITE_TAGLINE}</span>
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
