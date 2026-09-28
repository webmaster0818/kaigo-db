import { LICENSE_NAME, LICENSE_URL, SOURCE_NAME, SOURCE_URL } from "@/lib/site";

/**
 * CC BY 4.0 のクレジット表示。
 * ライセンス条件として、データを使っている「各ページ」に出す（フッター1行では済ませない）。
 * 取得日は meta テーブルの acquired_on を渡す。未取得なら日付を出さない（推測しない）。
 */
export default function SourceNote({ acquiredOn }: { acquiredOn?: string | null }) {
  return (
    <p className="mt-8 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
      出典：
      <a href={SOURCE_URL} rel="noopener noreferrer" target="_blank" className="underline hover:text-accent">
        {SOURCE_NAME}
      </a>
      （
      <a href={LICENSE_URL} rel="license noopener noreferrer" target="_blank" className="underline hover:text-accent">
        {LICENSE_NAME}
      </a>
      ）
      {acquiredOn ? `／取得日 ${acquiredOn}` : "／取得日 記載なし"}
      <br />
      本サイトは公表データをそのまま掲載しています。空欄の項目は「記載なし」と表示し、推測値では補っていません。
    </p>
  );
}
