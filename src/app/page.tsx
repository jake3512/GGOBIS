"use client";

import { useEffect, useMemo, useState } from "react";
import { ChampionPicker, type ChampionSummary } from "@/components/ChampionPicker";
import { ChampionIcon } from "@/components/ChampionIcon";
import { WinRateBar } from "@/components/WinRateBar";
import { SourceBreakdown } from "@/components/SourceBreakdown";
import { POSITIONS } from "@/lib/positions";

type Mode = "counter" | "duo";

interface ChampionBrief {
  id: number;
  name: string;
  iconUrl: string;
}

interface SourceValue {
  sourceId: string;
  sourceLabel: string;
  winRate: number;
  games: number;
}

interface SourceErrorInfo {
  sourceId: string;
  sourceLabel: string;
  message: string;
}

interface CounterEntry {
  championId: number;
  name: string;
  iconUrl: string;
  winRate: number;
  games: number;
  bySource: SourceValue[];
}

interface CounterResult {
  champion: ChampionBrief;
  position: string;
  sourcesSucceeded: number;
  sourcesAttempted: number;
  sourceErrors: SourceErrorInfo[];
  counters: CounterEntry[];
}

interface DuoResult {
  adc: ChampionBrief;
  support: ChampionBrief;
  sourcesSucceeded: number;
  sourcesAttempted: number;
  sourceErrors: SourceErrorInfo[];
  bySource: SourceValue[];
}

interface Slot {
  key: string;
  label: string;
  championId: number | null;
}

function SourceStatusNote({
  succeeded,
  attempted,
  errors,
}: {
  succeeded: number;
  attempted: number;
  errors: SourceErrorInfo[];
}) {
  if (errors.length === 0) return null;
  return (
    <details className="source-status">
      <summary>
        {attempted}개 소스 중 {succeeded}개 성공 ({errors.length}개 실패 — 눌러서 자세히 보기)
      </summary>
      <ul>
        {errors.map((e) => (
          <li key={e.sourceId}>
            <strong>{e.sourceLabel}</strong>: {e.message}
          </li>
        ))}
      </ul>
    </details>
  );
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
        <p>op.gg, u.gg, lolalytics 등 여러 사이트의 실제 통계를 요청할 때마다 실시간으로 가져와 보여줍니다 (자체 DB 없음).</p>
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
            연동된 사이트의 페이지 구조가 예상과 달라 발생하는 문제일 수 있습니다. 이 메시지를 그대로
            알려주시면 바로잡을게요.
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
            까다로운(=카운터) 챔피언입니다. 각 항목의 승률은 표본(게임 수)이 가장 많은 소스 기준이며, 아래에
            표본이 많은 순으로 최대 3개 소스를 함께 보여줍니다.
          </p>
          <SourceStatusNote
            succeeded={counterResult.sourcesSucceeded}
            attempted={counterResult.sourcesAttempted}
            errors={counterResult.sourceErrors}
          />
          <ol className="recommend-list">
            {counterResult.counters.map((c) => (
              <li key={c.championId} className="recommend-row recommend-row--stacked">
                <div className="recommend-row-main">
                  <ChampionIcon src={c.iconUrl} name={c.name} />
                  <span className="recommend-name">{c.name}</span>
                  <WinRateBar rate={c.winRate} games={c.games} />
                </div>
                <SourceBreakdown sources={c.bySource} />
              </li>
            ))}
            {counterResult.counters.length === 0 && (
              <p className="empty-hint">카운터 데이터를 찾지 못했습니다.</p>
            )}
          </ol>
        </section>
      )}

      {mode === "duo" && duoResult && (
        <section className="results">
          <h2>
            {duoResult.adc.name} + {duoResult.support.name} 듀오 시너지
          </h2>
          <SourceStatusNote
            succeeded={duoResult.sourcesSucceeded}
            attempted={duoResult.sourcesAttempted}
            errors={duoResult.sourceErrors}
          />
          {duoResult.bySource.length > 0 ? (
            <>
              <WinRateBar rate={duoResult.bySource[0].winRate} games={duoResult.bySource[0].games} />
              <SourceBreakdown sources={duoResult.bySource} />
            </>
          ) : (
            <p className="empty-hint">이 조합에 대한 데이터를 어느 소스에서도 찾지 못했습니다.</p>
          )}
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
