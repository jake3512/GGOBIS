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

  // 실제 드래프트 타이머에 맞춰 여러 슬롯을 연달아 채울 때(page.tsx가 이
  // 컴포넌트를 슬롯이 바뀔 때마다 새로 마운트함 — activeSlotKey를 key로
  // 씀) 매번 검색창을 손으로 다시 눌러야 하는 걸 줄이기 위해, 마운트되자마자
  // 자동 포커스 — 바로 타이핑을 시작할 수 있음.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /** 검색해서 후보가 하나로 좁혀졌을 때 타일을 직접 누르지 않고 Enter만으로
   * 바로 선택 — 이미 선택됐거나(다시 눌러도 되는 토글 대상) maxSelect에
   * 걸려 비활성화된 타일은 건너뛰고 실제로 고를 수 있는 첫 결과를 고른다. */
  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const pick = filtered.find((c) => selectedIds.includes(c.id) || selectedIds.length < maxSelect);
    if (pick) onToggle(pick.id);
  }

  return (
    <div className="champion-picker">
      <input
        ref={searchRef}
        type="text"
        placeholder="챔피언 이름 또는 역할군 검색 (예: 서포터) — Enter로 첫 결과 바로 선택"
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
