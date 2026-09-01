"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChampionIcon } from "@/components/ChampionIcon";

export interface ChampionSummary {
  id: number;
  slug: string;
  name: string;
  iconUrl: string;
  tags: string[];
}

export function ChampionPicker({
  champions,
  selectedIds,
  onToggle,
  maxSelect,
  elsewhereLabels,
  quickInput = false,
}: {
  champions: ChampionSummary[];
  selectedIds: number[];
  onToggle: (championId: number) => void;
  maxSelect: number;
  /** Optional championId → short label (e.g. "1티어") for champions that
   * aren't selected HERE but are already selected somewhere else the caller
   * considers noteworthy (e.g. a different mastery tier in the same
   * position's champion pool) — shows a small badge instead of the usual
   * selected checkmark, so picking one still works (moves it here, same as
   * any other tile) but the picker warns first that it's already elsewhere.
   * Ignored for any id also present in `selectedIds`. */
  elsewhereLabels?: Map<number, string>;
  /** 검색창 자동 포커스 + Enter로 첫 검색 결과 바로 선택 — 실제 드래프트
   * 타이머에 맞춰 여러 명을 연달아 빠르게 입력해야 하는 화면(조합 비교
   * 탭)에서만 켬. 기본 false — 챔피언 풀 편집기처럼 항상 펼쳐져 있는
   * 멀티 셀렉트 그리드에서 열릴 때마다 자동으로 포커스/키보드가 뜨는 건
   * 오히려 방해가 될 수 있어서 옵트인으로 뒀다. */
  quickInput?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return champions;
    return champions.filter(
      (c) => c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [champions, query]);

  useEffect(() => {
    if (quickInput) searchRef.current?.focus();
  }, [quickInput]);

  /** quickInput 모드에서만 동작 — 검색해서 후보를 좁힌 뒤 타일을 직접
   * 누르지 않고 Enter만으로 바로 선택. 이미 선택됐거나(다시 눌러도 되는
   * 토글 대상) maxSelect에 걸려 비활성화된 타일은 건너뛰고 실제로 고를 수
   * 있는 첫 결과를 고른다. */
  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!quickInput || e.key !== "Enter") return;
    const pick = filtered.find((c) => selectedIds.includes(c.id) || selectedIds.length < maxSelect);
    if (pick) onToggle(pick.id);
  }

  return (
    <div className="champion-picker">
      <input
        ref={searchRef}
        type="text"
        placeholder={
          quickInput
            ? "챔피언 이름 검색 — Enter로 첫 결과 바로 선택"
            : "챔피언 이름 또는 역할군 검색 (예: 서포터)"
        }
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        className="champion-search"
      />
      <div className="champion-grid">
        {filtered.map((champ) => {
          const selected = selectedIds.includes(champ.id);
          const elsewhereLabel = !selected ? elsewhereLabels?.get(champ.id) : undefined;
          const disabled = !selected && selectedIds.length >= maxSelect;
          return (
            <button
              key={champ.id}
              type="button"
              disabled={disabled}
              className={`champion-tile${selected ? " champion-tile--selected" : ""}${elsewhereLabel ? " champion-tile--elsewhere" : ""}`}
              onClick={() => onToggle(champ.id)}
              title={elsewhereLabel ? `${champ.name} (이미 ${elsewhereLabel}에 있음 — 선택하면 여기로 이동)` : champ.name}
            >
              <ChampionIcon src={champ.iconUrl} name={champ.name} />
              <span>{champ.name}</span>
              {elsewhereLabel && <span className="champion-tile-elsewhere-badge">{elsewhereLabel}</span>}
            </button>
          );
        })}
        {filtered.length === 0 && <p className="empty-hint">검색 결과가 없습니다.</p>}
      </div>
    </div>
  );
}
