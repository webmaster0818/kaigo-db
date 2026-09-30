#!/usr/bin/env bash
# かいごDB のデプロイ手順をまとめたもの。
#
# 前提: Cloudflare の認証が通っていること。どちらかでよい。
#   - `npx wrangler login`（ブラウザで対話ログイン）
#   - もしくは環境変数 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
#
# 使い方:
#   scripts/deploy.sh init     D1を作る（最初の1回だけ）
#   scripts/deploy.sh load     31,441施設ぶんのデータを本番D1へ投入（最初の1回だけ／データ更新時）
#   scripts/deploy.sh ship     ビルドしてWorkerをデプロイ（毎回これ）
#   scripts/deploy.sh verify   本番URLを叩いて反映を確認
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="kaigo-db"
SITE="https://kaigo-database.com"

case "${1:-}" in
  init)
    # 出力される database_id を wrangler.jsonc の PLACEHOLDER_RUN_WRANGLER_D1_CREATE と差し替える
    npx wrangler d1 create "$DB_NAME"
    echo
    echo "▲ 上に出た database_id を wrangler.jsonc に貼ってください。"
    ;;

  load)
    if grep -q PLACEHOLDER wrangler.jsonc; then
      echo "wrangler.jsonc の database_id がまだ PLACEHOLDER です。先に init を実行してIDを貼ってください。" >&2
      exit 1
    fi
    # data/d1/*.sql は import.ts が吐いた分割済みSQL。番号順に流す必要がある
    # （schema → facility → corporation → place → area/meta の順に採番済み）。
    shopt -s nullglob
    files=(data/d1/*.sql)
    if [ ${#files[@]} -eq 0 ]; then
      echo "data/d1/*.sql がありません。先に \`npm run import\` を実行してください。" >&2
      exit 1
    fi
    for f in "${files[@]}"; do
      echo "== $f"
      npx wrangler d1 execute "$DB_NAME" --remote --yes --file "$f"
    done
    echo
    echo "== 件数の確認"
    npx wrangler d1 execute "$DB_NAME" --remote --yes \
      --command "select 'facility' t, count(*) n from facility
                 union all select 'corporation', count(*) from corporation
                 union all select 'place', count(*) from place
                 union all select 'area', count(*) from area;"
    ;;

  ship)
    npx opennextjs-cloudflare build
    npx wrangler deploy
    ;;

  verify)
    # Cloudflareのエッジキャッシュで古い内容が返ることがあるのでキャッシュバスターを付ける
    for p in / /type/ /area/ /hojin/ /data/ /ranking/; do
      code=$(curl -s -o /dev/null -w "%{http_code}" "${SITE}${p}?cb=$RANDOM")
      echo "$code  ${SITE}${p}"
    done
    echo
    echo "== 掲載件数がページに出ているか（0件ならD1が空）"
    curl -s "${SITE}/?cb=$RANDOM" | grep -o '掲載事業所数[^<]*' | head -1 || echo "(取得できず)"
    ;;

  *)
    sed -n '2,20p' "$0"
    exit 1
    ;;
esac
