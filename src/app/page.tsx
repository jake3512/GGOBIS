"use client";

import { useEffect, useMemo, useState } from "react";
import { ChampionPicker, type ChampionSummary } from "@/components/ChampionPicker";
import { ChampionIcon } from "@/components/ChampionIcon";
import { WinRateBar } from "@/components/WinRateBar";

type Mode = "counter" | "duo";

const POSITIONS: { value: string; label: string }[] = [
  { value: "top", label: "탑" },
  { value: "jungle", label: "정글" },
  { value: "mid", label: "미드" },
  { value: "adc", label: "원거리 딜러" },
  { value: "support", label: "서포터" },
];

interface ChampionBrief {
  id: number;
  name: string;
  iconUrl: string;
}

interface CounterEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
}

interface CounterResult {
  champion: ChampionBrief;
  position: string;
  sourceUrl: string;
  counters: CounterEntry[];
}

interface DuoResult {
  adc: ChampionBrief;
  support: ChampionBrief;
  sourceUrl: string;
  winRate: number | null;
  games: number | null;
}

interface Slot {
  key: string;
  label: string;
  championId: number | null;
}

export default function Home() {
  const [champions, setChampions] = useState<ChampionSummary[]>([]);
  const [champLoadError, setChampLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("counter");
  const [position, setPosition] = useState("top");
  const [slots, setSlots] = useState<Slot[]>([{ key: "target", label: "기준 챔피언", championId: null }]);
  const [activeSlotKey, setActiveSlotKey] = useState("target");
  const [counterResult, setCounterResult] = useState<CounterResult | null>(null);
  const [duoResult, setDuoResult] = useState<DuoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/champions")
      .then((res) => res.json())
      .then((data) => setChampions(data.champions))
      .catch(() => setChampLoadError("챔피언 목록을 불러오지 못했습니다."));
  }, []);

  const championById = useMemo(() => {
    const map = new Map<number, ChampionSummary>();
    for (const c of champions) map.set(c.id, c);
    return map;
  }, [champions]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setCounterResult(null);
    setDuoResult(null);
    if (next === "counter") {
      const nextSlots: Slot[] = [{ key: "target", label: "기준 챔피언", championId: null }];
      setSlots(nextSlots);
      setActiveSlotKey(nextSlots[0].key);
    } else {
      const nextSlots: Slot[] = [
        { key: "adc", label: "원거리 딜러", championId: null },
        { key: "support", label: "서포터", championId: null },
      ];
      setSlots(nextSlots);
      setActiveSlotKey(nextSlots[0].key);
    }
  }

  function assignActiveSlot(championId: number) {
    setSlots((prev) => {
      const next = prev.map((s) => (s.key === activeSlotKey ? { ...s, championId } : s));
      const nextEmpty = next.find((s) => s.key !== activeSlotKey && s.championId === null);
      if (nextEmpty) setActiveSlotKey(nextEmpty.key);
      return next;
    });
  }

  function clearSlot(key: string) {
    setSlots((prev) => prev.map((s) => (s.key === key ? { ...s, championId: null } : s)));
    setActiveSlotKey(key);
  }

  const activeSlotChampionId = slots.find((s) => s.key === activeSlotKey)?.championId ?? null;
  const pickerSelectedIds = activeSlotChampionId !== null ? [activeSlotChampionId] : [];

  const canRun =
    mode === "counter"
      ? slots[0]?.championId !== null
      : slots.every((s) => s.championId !== null);

  async function runLookup() {
    setError(null);
    setLoading(true);
    try {
      if (mode === "counter") {
        const championId = slots[0].championId;
        const res = await fetch(`/api/counters?championId=${championId}&position=${position}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "조회에 실패했습니다.");
        setCounterResult(data);
      } else {
        const adcId = slots.find((s) => s.key === "adc")?.championId;
        const supportId = slots.find((s) => s.key === "support")?.championId;
        const res = await fetch(`/api/duo?adcId=${adcId}&supportId=${supportId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "조회에 실패했습니다.");
        setDuoResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>LoL 라인 카운터 / 바텀 듀오 조회</h1>
        <p>op.gg의 실제 통계를 요청할 때마다 실시간으로 가져와 보여줍니다 (자체 DB 없음).</p>
      </header>

      <div className="mode-tabs">
        <button
          type="button"
          className={mode === "counter" ? "tab tab--active" : "tab"}
          onClick={() => switchMode("counter")}
        >
          라인 카운터
        </button>
        <button
          type="button"
          className={mode === "duo" ? "tab tab--active" : "tab"}
          onClick={() => switchMode("duo")}
        >
          바텀 듀오 시너지
        </button>
      </div>

      {mode === "counter" && (
        <div className="position-tabs">
          {POSITIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={position === p.value ? "tab tab--active" : "tab"}
              onClick={() => setPosition(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <section className="selected-bar">
        <div className="slot-row">
          {slots.map((slot) => {
            const champ = slot.championId !== null ? championById.get(slot.championId) : null;
            const active = slot.key === activeSlotKey;
            return (
              <button
                key={slot.key}
                type="button"
                className={`slot${active ? " slot--active" : ""}${champ ? "" : " slot--empty"}`}
                onClick={() => (champ ? clearSlot(slot.key) : setActiveSlotKey(slot.key))}
              >
                {champ ? (
                  <>
                    <ChampionIcon src={champ.iconUrl} name={champ.name} />
                    <span>{champ.name}</span>
                  </>
                ) : (
                  <span>{slot.label} 선택</span>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" className="run-button" disabled={!canRun || loading} onClick={runLookup}>
          {loading ? "조회 중..." : mode === "counter" ? "카운터 조회" : "듀오 시너지 조회"}
        </button>
      </section>

      {error && (
        <p className="error-banner">
          {error}
          <br />
          <span className="empty-hint">
            op.gg 페이지 구조가 예상과 달라 발생하는 문제일 수 있습니다. 이 메시지를 그대로 알려주시면
            바로잡을게요.
          </span>
        </p>
      )}
      {champLoadError && <p className="error-banner">{champLoadError}</p>}

      {mode === "counter" && counterResult && (
        <section className="results">
          <h2>
            {counterResult.champion.name} ({POSITIONS.find((p) => p.value === counterResult.position)?.label}) 카운터
          </h2>
          <p className="empty-hint">
            승률은 {counterResult.champion.name} 기준 상대 챔피언과 붙었을 때의 승률입니다. 낮을수록 상대하기
            까다로운(=카운터) 챔피언입니다.
          </p>
          <ol className="recommend-list">
            {counterResult.counters.map((c) => (
              <li key={c.championId} className="recommend-row">
                <ChampionIcon src={c.iconUrl} name={c.name} />
                <span className="recommend-name">{c.name}</span>
                <WinRateBar rate={c.winRate} games={c.games} />
              </li>
            ))}
            {counterResult.counters.length === 0 && (
              <p className="empty-hint">카운터 데이터를 찾지 못했습니다.</p>
            )}
          </ol>
          <p className="source-note">
            출처:{" "}
            <a href={counterResult.sourceUrl} target="_blank" rel="noreferrer">
              op.gg
            </a>
          </p>
        </section>
      )}

      {mode === "duo" && duoResult && (
        <section className="results">
          <h2>
            {duoResult.adc.name} + {duoResult.support.name} 듀오 시너지
          </h2>
          {duoResult.winRate !== null ? (
            <WinRateBar rate={duoResult.winRate} games={duoResult.games ?? undefined} />
          ) : (
            <p className="empty-hint">이 조합에 대한 데이터를 op.gg에서 찾지 못했습니다.</p>
          )}
          <p className="source-note">
            출처:{" "}
            <a href={duoResult.sourceUrl} target="_blank" rel="noreferrer">
              op.gg
            </a>
          </p>
        </section>
      )}

      <section className="picker-section">
        <ChampionPicker
          champions={champions}
          selectedIds={pickerSelectedIds}
          onToggle={assignActiveSlot}
          maxSelect={champions.length || 1}
        />
      </section>
    </main>
  );
}
