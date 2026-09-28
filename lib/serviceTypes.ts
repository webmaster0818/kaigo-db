// サービス種別の定義。
// 厚労省オープンデータはサービス種別ごとに35本のCSVに分かれており、種別名の表記は
// ファイル名/列で微妙に揺れる。ここで「正式名 → スラッグ」を固定し、
// 未知の種別が来たら svc-<hash> を自動採番する（落とさない）。

import { shortHash } from "./slug";

export interface ServiceTypeDef {
  /** 表示名 */
  name: string;
  /** URLスラッグ */
  slug: string;
  /** 入居系（住まいとして選ぶ種別）か */
  residential: boolean;
  /** CSVファイル名や列値の表記ゆれ（部分一致で判定） */
  aliases: string[];
}

export const SERVICE_TYPES: ServiceTypeDef[] = [
  // ---- 入居系4種（今回の中心。計31,324件の想定） ----
  {
    name: "有料老人ホーム",
    slug: "yuryo-rojin-home",
    residential: true,
    aliases: ["有料老人ホーム", "特定施設入居者生活介護"],
  },
  {
    name: "認知症対応型共同生活介護（グループホーム）",
    slug: "group-home",
    residential: true,
    aliases: ["認知症対応型共同生活介護", "グループホーム"],
  },
  {
    name: "介護老人福祉施設（特別養護老人ホーム）",
    slug: "tokuyo",
    residential: true,
    aliases: ["介護老人福祉施設", "特別養護老人ホーム", "特養", "地域密着型介護老人福祉施設"],
  },
  {
    name: "介護老人保健施設",
    slug: "roken",
    residential: true,
    aliases: ["介護老人保健施設", "老健"],
  },

  // ---- 在宅系（主要なもの。ここに無い種別も import は受け付ける） ----
  { name: "訪問介護", slug: "homon-kaigo", residential: false, aliases: ["訪問介護"] },
  { name: "訪問入浴介護", slug: "homon-nyuyoku", residential: false, aliases: ["訪問入浴介護"] },
  { name: "訪問看護", slug: "homon-kango", residential: false, aliases: ["訪問看護"] },
  { name: "訪問リハビリテーション", slug: "homon-rehab", residential: false, aliases: ["訪問リハビリテーション"] },
  { name: "通所介護（デイサービス）", slug: "day-service", residential: false, aliases: ["通所介護", "デイサービス", "地域密着型通所介護"] },
  { name: "通所リハビリテーション（デイケア）", slug: "day-care", residential: false, aliases: ["通所リハビリテーション", "デイケア"] },
  { name: "短期入所生活介護（ショートステイ）", slug: "short-stay", residential: false, aliases: ["短期入所生活介護", "ショートステイ"] },
  { name: "短期入所療養介護", slug: "short-stay-ryoyo", residential: false, aliases: ["短期入所療養介護"] },
  { name: "福祉用具貸与", slug: "fukushi-yogu", residential: false, aliases: ["福祉用具貸与", "特定福祉用具販売"] },
  { name: "居宅介護支援", slug: "kyotaku-shien", residential: false, aliases: ["居宅介護支援"] },
  { name: "小規模多機能型居宅介護", slug: "shokibo-takino", residential: false, aliases: ["小規模多機能型居宅介護"] },
  { name: "看護小規模多機能型居宅介護", slug: "kango-shokibo", residential: false, aliases: ["看護小規模多機能型居宅介護", "複合型サービス"] },
  { name: "定期巡回・随時対応型訪問介護看護", slug: "teiki-junkai", residential: false, aliases: ["定期巡回"] },
  { name: "夜間対応型訪問介護", slug: "yakan-homon", residential: false, aliases: ["夜間対応型訪問介護"] },
  { name: "認知症対応型通所介護", slug: "ninchisho-day", residential: false, aliases: ["認知症対応型通所介護"] },
  { name: "介護医療院", slug: "kaigo-iryoin", residential: false, aliases: ["介護医療院", "介護療養型医療施設"] },
];

/**
 * 種別名（CSVの列値やファイル名）から定義を引く。
 * 完全一致 → エイリアス部分一致 の順。見つからなければ null。
 */
export function findServiceType(raw: string): ServiceTypeDef | null {
  const s = (raw || "").trim();
  if (!s) return null;
  for (const t of SERVICE_TYPES) if (t.name === s) return t;
  // 長いエイリアスから先に見て、「通所介護」が「認知症対応型通所介護」を誤取りしないようにする
  const byLen = SERVICE_TYPES.flatMap((t) => t.aliases.map((a) => ({ t, a })))
    .sort((x, y) => y.a.length - x.a.length);
  for (const { t, a } of byLen) if (s.includes(a)) return t;
  return null;
}

/** 未知種別でも必ずスラッグを返す（落とさないための保険） */
export function resolveServiceType(raw: string): { name: string; slug: string; residential: boolean; known: boolean } {
  const hit = findServiceType(raw);
  if (hit) return { name: hit.name, slug: hit.slug, residential: hit.residential, known: true };
  const name = (raw || "").trim() || "種別不明";
  return { name, slug: `svc-${shortHash(name)}`, residential: false, known: false };
}
