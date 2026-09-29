"use client";

import { useState } from "react";
import type { TypeCount } from "@/lib/db";

/**
 * 住所・地名（＋距離）で探すフォーム。
 *
 * GETでクエリを付け直すだけなので、JavaScriptが無効でも住所入力での検索は動く。
 * 「現在地を使う」だけが JS を必要とする（Geolocation API）。
 *
 * 地名→座標の変換は外部APIを使わず、import 時に掲載データから作った辞書（place テーブル）を引く。
 * したがって掲載データに出てこない地名は解決できない。その場合は候補を出して正直に伝える。
 */
export default function PlaceSearchForm({
  types,
  defaults,
}: {
  types: TypeCount[];
  defaults: { q?: string; lat?: string; lng?: string; radius?: string; type?: string; sort?: string };
}) {
  const [q, setQ] = useState(defaults.q ?? "");
  // 現在地検索の座標。住所を打ち直したら捨てる（両方送ると起点が曖昧になるため）
  const [lat, setLat] = useState(defaults.lat ?? "");
  const [lng, setLng] = useState(defaults.lng ?? "");
  const [status, setStatus] = useState("");

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("この端末では現在地を取得できません。住所や地名を入力してください。");
      return;
    }
    setStatus("現在地を取得しています…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setQ("");
        setStatus("現在地を取得しました。「検索」を押してください。");
      },
      () => setStatus("現在地を取得できませんでした。住所や地名を入力してください。"),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  return (
    <form method="get" action="/" className="rounded border border-line-strong bg-surface p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <label className="block text-xs">
          <span className="font-bold text-ink">住所・地名</span>
          <input
            name="q"
            value={q}
            onChange={(e) => { setQ(e.target.value); setLat(""); setLng(""); }}
            placeholder="例: 東京都世田谷区成城 / 札幌市中央区"
            autoComplete="street-address"
            className="mt-1 w-full rounded border border-line-strong px-3 py-2 text-base sm:text-sm"
          />
        </label>

        <label className="block text-xs">
          <span className="font-bold text-ink">距離</span>
          <select
            name="radius"
            defaultValue={defaults.radius ?? "3"}
            className="mt-1 w-full rounded border border-line-strong bg-surface px-3 py-2 text-base sm:text-sm"
          >
            {["1", "3", "5", "10", "20"].map((r) => (
              <option key={r} value={r}>{r}km以内</option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="font-bold text-ink">サービス種別</span>
          <select
            name="type"
            defaultValue={defaults.type ?? ""}
            className="mt-1 w-full rounded border border-line-strong bg-surface px-3 py-2 text-base sm:text-sm"
          >
            <option value="">すべて</option>
            {types.map((t) => (
              <option key={t.service_type_slug} value={t.service_type_slug}>
                {t.service_type}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 現在地を使ったときだけ値が入る */}
      <input type="hidden" name="lat" value={lat} />
      <input type="hidden" name="lng" value={lng} />
      {/* 並べ替えは既定で近い順。結果側でも切り替えられる */}
      <input type="hidden" name="sort" value={defaults.sort === "capacity" ? "capacity" : "distance"} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="rounded bg-accent px-6 py-2 text-sm font-bold text-white hover:bg-accent-strong"
        >
          近い順に探す
        </button>
        <button
          type="button"
          onClick={locate}
          className="rounded border border-line-strong px-3 py-2 text-xs hover:bg-tint"
        >
          現在地を使う
        </button>
        {lat && lng && (
          <span className="text-xs tabular-nums text-muted">現在地 {lat}, {lng}</span>
        )}
        {status && <span className="text-xs text-muted">{status}</span>}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        入力した地名は、掲載施設の緯度・経度から作った地名辞書で座標に変換しています（外部の地図サービスは使っていません）。
        駅名を入れた場合は、同じ名前の地名の位置で検索します（駅の座標そのものは持っていません）。
      </p>
    </form>
  );
}
