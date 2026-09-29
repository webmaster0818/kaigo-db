"use client";

import { useState } from "react";
import type { TypeCount } from "@/lib/db";

/**
 * 現在地（緯度経度）＋距離で検索するフォーム。
 * GETでクエリを付け直すだけなので、JSが無効でも「緯度経度を直接入れる」使い方はできる。
 *
 * 【未実装】住所・駅名からの緯度経度変換（ジオコーディング）は外部APIが必要なため未接続。
 * ここでは lat/lng を受け取る口だけ用意している。
 */
export default function GeoSearchForm({
  types,
  defaults,
}: {
  types: TypeCount[];
  defaults: { lat?: string; lng?: string; radius?: string; type?: string; sort?: string };
}) {
  const [lat, setLat] = useState(defaults.lat ?? "");
  const [lng, setLng] = useState(defaults.lng ?? "");
  const [status, setStatus] = useState<string>("");

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("この端末では現在地を取得できません。緯度・経度を直接入力してください。");
      return;
    }
    setStatus("現在地を取得しています…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setStatus("現在地を取得しました。");
      },
      () => setStatus("現在地を取得できませんでした。緯度・経度を直接入力してください。"),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  return (
    <form method="get" action="/" className="rounded border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-xs">
          <span className="text-muted">緯度</span>
          <input
            name="lat"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            inputMode="decimal"
            placeholder="35.658034"
            className="mt-1 w-full rounded border border-line-strong px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted">経度</span>
          <input
            name="lng"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            inputMode="decimal"
            placeholder="139.701636"
            className="mt-1 w-full rounded border border-line-strong px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted">距離</span>
          <select
            name="radius"
            defaultValue={defaults.radius ?? "3"}
            className="mt-1 w-full rounded border border-line-strong bg-surface px-2 py-1.5 text-sm"
          >
            {["1", "3", "5", "10", "20"].map((r) => (
              <option key={r} value={r}>{r}km以内</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-muted">サービス種別</span>
          <select
            name="type"
            defaultValue={defaults.type ?? ""}
            className="mt-1 w-full rounded border border-line-strong bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">すべて</option>
            {types.map((t) => (
              <option key={t.service_type_slug} value={t.service_type_slug}>
                {t.service_type}
              </option>
            ))}
          </select>
        </label>

        {/* 「近い順」はこの検索そのもの。並べ替えの軸として明示する。 */}
        <label className="block text-xs">
          <span className="text-muted">並べ替え</span>
          <select
            name="sort"
            defaultValue={defaults.sort ?? "distance"}
            className="mt-1 w-full rounded border border-line-strong bg-surface px-2 py-1.5 text-sm"
          >
            <option value="distance">近い順（直線距離）</option>
            <option value="capacity">定員が多い順</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="rounded bg-accent px-4 py-1.5 text-sm font-bold text-white hover:bg-accent-strong"
        >
          検索
        </button>
        <button
          type="button"
          onClick={locate}
          className="rounded border border-line-strong px-3 py-1.5 text-xs hover:bg-tint"
        >
          現在地を使う
        </button>
        {status && <span className="text-xs text-muted">{status}</span>}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        住所・駅名からの検索は準備中です。現在は緯度・経度での検索に対応しています。
      </p>
    </form>
  );
}
