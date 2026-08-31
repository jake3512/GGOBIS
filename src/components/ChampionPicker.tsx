"use client";

import { useMemo, useState } from "react";
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return champions;
    return champions.filter(
      (c) => c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [champions, query]);

  return (
    <div className="champion-picker">
      <input
        type="text"
        placeholder="챔피언 이름 또는 역할군 검색 (예: 서포터)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
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
