"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { TypeCount } from "@/lib/db";
import { loadIndex, searchCandidates, type Candidate } from "@/lib/addrSearch";

const KIND_LABEL: Record<Candidate["kind"], string> = { pref: "都道府県", city: "市区町村", town: "地名", addr: "住所" };

/**
 * 住所・地名（＋距離）で探すフォーム。
 *
 * GETでクエリを付け直すだけなので、JavaScriptが無効でも住所入力での検索は動く。
 * 「現在地を使う」だけが JS を必要とする（Geolocation API）。
 *
 * 地名→座標の変換は外部APIを使わず、import 時に掲載データから作った辞書（place テーブル）を引く。
 * したがって掲載データに出てこない地名は解決できない。その場合は候補を出して正直に伝える。
 *
 * 入力中の候補（住所オートコンプリート）：掲載施設の住所（番地まで）・町域・市区町村を、ビルド時に作った
 * 静的な索引（public/addr/・scripts/gen-addr-index.ts）からブラウザ内で照合して出す。入力のたびにサーバー・D1 は読まない。
 * 候補を選ぶと、その地点の緯度・経度で既存の距離検索（/?lat=&lng=&radius=&type=&sort=distance）に移る。
 * 候補を選ばずに送信したときは従来どおり（q を送る）。
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
  const [cands, setCands] = useState<Candidate[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const formRef = useRef<HTMLFormElement>(null);
  const seqRef = useRef(0);
  const listId = useId();

  // 入力が止まってから照合する（静的ファイルの読み込みは最初の1回だけ）
  useEffect(() => {
    const text = q.trim();
    if (!text || lat) {
      setCands([]);
      return;
    }
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      searchCandidates(text).then((list) => {
        if (seq !== seqRef.current) return;
        setCands(list);
        setActive(-1);
      });
    }, 80);
    return () => clearTimeout(t);
  }, [q, lat]);

  function choose(c: Candidate) {
    const form = formRef.current;
    const radius = (form?.elements.namedItem("radius") as HTMLSelectElement | null)?.value ?? "3";
    const type = (form?.elements.namedItem("type") as HTMLSelectElement | null)?.value ?? "";
    const p = new URLSearchParams();
    p.set("q", c.label);
    p.set("lat", String(c.lat));
    p.set("lng", String(c.lng));
    p.set("radius", radius);
    if (type) p.set("type", type);
    p.set("sort", "distance");
    setOpen(false);
    window.location.assign(`/?${p.toString()}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const shown = open && cands.length > 0;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      if (cands.length) setActive((i) => (i + 1) % cands.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cands.length) setActive((i) => (i <= 0 ? cands.length - 1 : i - 1));
    } else if (e.key === "Enter" && shown && active >= 0) {
      e.preventDefault();
      choose(cands[active]);
    } else if (e.key === "Escape" && shown) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const expanded = open && cands.length > 0;

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
    <form ref={formRef} method="get" action="/" className="card p-5 sm:p-7">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="relative block text-xs">
          <label htmlFor={`${listId}-q`} className="font-bold tracking-wider text-ink">住所・地名</label>
          <input
            id={`${listId}-q`}
            name="q"
            value={q}
            onChange={(e) => { setQ(e.target.value); setLat(""); setLng(""); setOpen(true); }}
            onFocus={() => { void loadIndex(); setOpen(true); }}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder="例: 東京都世田谷区成城 / 札幌市中央区"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={`${listId}-list`}
            aria-activedescendant={expanded && active >= 0 ? `${listId}-o${active}` : undefined}
            className="field mt-1.5"
          />
          <ul
            id={`${listId}-list`}
            role="listbox"
            aria-label="住所・地名の候補"
            hidden={!expanded}
            className="ac-list"
          >
            {cands.map((c, i) => (
              <li
                key={`${c.kind}-${c.label}`}
                id={`${listId}-o${i}`}
                role="option"
                aria-selected={i === active}
                className="ac-option"
                // 入力欄のフォーカスを外さない（blur で候補が閉じる前にタップを受ける）
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
              >
                <span className="ac-kind">{KIND_LABEL[c.kind]}</span>
                <span className="ac-label">{c.label}</span>
                <span className="ac-count">{c.n.toLocaleString()}件</span>
              </li>
            ))}
          </ul>
          <span className="sr-only" aria-live="polite">{expanded ? `候補${cands.length}件` : ""}</span>
        </div>

        <label className="block text-xs">
          <span className="font-bold tracking-wider text-ink">距離</span>
          <select
            name="radius"
            defaultValue={defaults.radius ?? "3"}
            className="field mt-1.5"
          >
            {["1", "3", "5", "10", "20"].map((r) => (
              <option key={r} value={r}>{r}km以内</option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="font-bold tracking-wider text-ink">サービス種別</span>
          <select
            name="type"
            defaultValue={defaults.type ?? ""}
            className="field mt-1.5"
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

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="btn-primary w-full sm:w-auto sm:min-w-[12rem]"
        >
          近い順に検索
        </button>
        <button
          type="button"
          onClick={locate}
          className="btn-secondary w-full sm:w-auto"
        >
          現在地を使用
        </button>
        {lat && lng && !q && (
          <span className="text-xs tabular-nums text-muted">現在地 {lat}, {lng}</span>
        )}
        {status && <span className="text-xs text-muted">{status}</span>}
      </div>

      <p className="mt-5 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
        入力した地名は、掲載施設の緯度・経度から作成した地名辞書により座標に変換しています（外部の地図サービスは使用していません）。
        駅名を入力した場合は、同じ名称の地名の位置で検索します（駅の座標は保有していません）。
      </p>
    </form>
  );
}
