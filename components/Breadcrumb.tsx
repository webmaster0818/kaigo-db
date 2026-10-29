import Link from "next/link";
import { SITE_URL } from "@/lib/site";

export interface Crumb {
  name: string;
  /** 現在地(最後の項目)は href を省略する */
  href?: string;
}

/** 視覚的なパンくず + BreadcrumbList JSON-LD を1か所で生成する */
export default function Breadcrumb({ items }: { items: Crumb[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.href ? { item: `${SITE_URL}${c.href}` } : {}),
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav aria-label="パンくずリスト" className="mb-8">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {items.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex items-center gap-2">
              {c.href ? (
                <Link href={c.href} className="underline-offset-4 hover:text-ink hover:underline">
                  {c.name}
                </Link>
              ) : (
                <span className="font-medium text-ink" aria-current="page">
                  {c.name}
                </span>
              )}
              {i < items.length - 1 && <span className="text-muted-2">›</span>}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
