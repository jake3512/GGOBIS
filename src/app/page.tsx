"use client";

import { useEffect, useMemo, useState } from "react";
import { ChampionPicker, type ChampionSummary } from "@/components/ChampionPicker";
import { ChampionIcon } from "@/components/ChampionIcon";
import { WinRateBar } from "@/components/WinRateBar";

type Mode = "teammates" | "comp";

// API responses key champions by `championId` (not `id`, which is reserved
// for the /api/champions list that backs the picker/chips).
interface RecommendedChampion {
  championId: number;
  name: string;
  iconUrl: string;
  tags: string[];
}

interface TeammateRecommendation extends RecommendedChampion {
  winRate: number;
  sampleGames: number;
}

interface CompResult {
  team: RecommendedChampion[];
  synergyScore: number;
  pairBreakdown: {
    championA: RecommendedChampion;
    championB: RecommendedChampion;
    winRate: number;
    sampleGames: number;
  }[];
  topCounterPicks: (RecommendedChampion & { winRate: number })[];
  composedCounterTeam: {
    synergyScore: number;
    avgCounterScore: number;
    team: (RecommendedChampion & {
      counterWinRate: number;
      synergyWithTeamSoFar: number | null;
    })[];
  };
}

export default function Home() {
  const [champions, setChampions] = useState<ChampionSummary[]>([]);
  const [champLoadError, setChampLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("teammates");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [teammateResults, setTeammateResults] = useState<TeammateRecommendation[] | null>(null);
  const [compResult, setCompResult] = useState<CompResult | null>(null);
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

  const maxSelect = mode === "teammates" ? 4 : 5;

  function switchMode(next: Mode) {
    setMode(next);
    setSelectedIds([]);
    setTeammateResults(null);
    setCompResult(null);
    setError(null);
  }

  function toggleChampion(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, maxSelect),
    );
  }

  async function runRecommendation() {
    setError(null);
    setLoading(true);
    try {
      if (mode === "teammates") {
        const res = await fetch("/api/recommend/teammates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ championIds: selectedIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
        setTeammateResults(data.recommendations);
      } else {
        const res = await fetch("/api/recommend/comp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team: selectedIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
        setCompResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const canRun =
    mode === "teammates" ? selectedIds.length >= 1 && selectedIds.length <= 4 : selectedIds.length === 5;

  return (
    <main className="page">
      <header className="page-header">
        <h1>LoL 챔피언 조합 추천</h1>
        <p>실제 매치 데이터를 기반으로 시너지가 좋은 조합과 카운터 조합을 추천합니다.</p>
      </header>

      <div className="mode-tabs">
        <button
          type="button"
          className={mode === "teammates" ? "tab tab--active" : "tab"}
          onClick={() => switchMode("teammates")}
        >
          챔피언 1~4개 → 남은 자리 추천
        </button>
        <button
          type="button"
          className={mode === "comp" ? "tab tab--active" : "tab"}
          onClick={() => switchMode("comp")}
        >
          5인 조합 평가 + 카운터 추천
        </button>
      </div>

      <section className="selected-bar">
        <span className="selected-label">
          선택됨 ({selectedIds.length}/{maxSelect})
        </span>
        <div className="selected-chips">
          {selectedIds.map((id) => {
            const champ = championById.get(id);
            if (!champ) return null;
            return (
              <button
                key={id}
                type="button"
                className="chip"
                onClick={() => toggleChampion(id)}
                title="클릭해서 제거"
              >
                <ChampionIcon src={champ.iconUrl} name={champ.name} />
                {champ.name}
                <span className="chip-x">×</span>
              </button>
            );
          })}
          {selectedIds.length === 0 && <span className="empty-hint">아래에서 챔피언을 선택하세요.</span>}
        </div>
        <button
          type="button"
          className="run-button"
          disabled={!canRun || loading}
          onClick={runRecommendation}
        >
          {loading ? "계산 중..." : mode === "teammates" ? "추천받기" : "평가하기"}
        </button>
      </section>

      {error && <p className="error-banner">{error}</p>}
      {champLoadError && <p className="error-banner">{champLoadError}</p>}

      {mode === "teammates" && teammateResults && (
        <section className="results">
          <h2>추천 챔피언</h2>
          <ol className="recommend-list">
            {teammateResults.map((r) => (
              <li key={r.championId} className="recommend-row">
                <ChampionIcon src={r.iconUrl} name={r.name} />
                <span className="recommend-name">{r.name}</span>
                <WinRateBar rate={r.winRate} games={r.sampleGames} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {mode === "comp" && compResult && (
        <section className="results">
          <h2>조합 평가</h2>
          <div className="synergy-summary">
            <span>이 조합의 평균 시너지 승률</span>
            <WinRateBar rate={compResult.synergyScore} />
          </div>

          <h3>페어별 시너지</h3>
          <ul className="pair-list">
            {compResult.pairBreakdown.map((p, i) => (
              <li key={i} className="pair-row">
                <span className="pair-names">
                  {p.championA.name} + {p.championB.name}
                </span>
                <WinRateBar rate={p.winRate} games={p.sampleGames} />
              </li>
            ))}
          </ul>

          <h3>이 조합을 상대하기 좋은 챔피언 (개별)</h3>
          <ol className="recommend-list">
            {compResult.topCounterPicks.map((c) => (
              <li key={c.championId} className="recommend-row">
                <ChampionIcon src={c.iconUrl} name={c.name} />
                <span className="recommend-name">{c.name}</span>
                <WinRateBar rate={c.winRate} />
              </li>
            ))}
          </ol>

          <h3>이 조합을 상대하기 좋은 추천 5인 조합</h3>
          <p className="empty-hint">
            평균 카운터 승률 {(compResult.composedCounterTeam.avgCounterScore * 100).toFixed(1)}% · 팀
            내부 시너지 {(compResult.composedCounterTeam.synergyScore * 100).toFixed(1)}%
          </p>
          <ol className="recommend-list">
            {compResult.composedCounterTeam.team.map((c) => (
              <li key={c.championId} className="recommend-row">
                <ChampionIcon src={c.iconUrl} name={c.name} />
                <span className="recommend-name">{c.name}</span>
                <WinRateBar rate={c.counterWinRate} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="picker-section">
        <ChampionPicker
          champions={champions}
          selectedIds={selectedIds}
          onToggle={toggleChampion}
          maxSelect={maxSelect}
        />
      </section>
    </main>
  );
}
