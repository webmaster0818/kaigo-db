// opennextjs-cloudflare build の後に実行する。Next が書き出した _not-found.html の head から、
// ビルドごとに名前の変わる CSS・アイコンの <link> を取り出し、worker.ts の直接描画（lib/direct.ts）用に保存する。
// 取り出せなければ失敗で終わる（ship が止まる）。
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync(".next/server/app/_not-found.html", "utf8");
const headEnd = html.indexOf("</head>");
if (headEnd < 0) throw new Error("_not-found.html に </head> がありません");
const headHtml = html.slice(0, headEnd);
const links = headHtml.match(/<link [^>]*\/>/g) ?? [];
const styles = links.filter((l) => /rel="stylesheet"/.test(l));
const icons = links.filter((l) => /rel="(icon|apple-touch-icon)"/.test(l));
if (styles.length === 0) throw new Error("stylesheet の <link> が見つかりません");
if (icons.length === 0) throw new Error("icon の <link> が見つかりません");
const linkHeader = styles
  .map((l) => `<${l.match(/href="([^"]+)"/)[1]}>; rel=preload; as="style"`)
  .join(", ");
const out = { styles: styles.join(""), icons: icons.join(""), linkHeader };
writeFileSync("lib/direct-shell.generated.json", JSON.stringify(out, null, 2) + "\n");
console.log("lib/direct-shell.generated.json:", out);
