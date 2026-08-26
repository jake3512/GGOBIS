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
}: {
  champions: ChampionSummary[];
  selectedIds: number[];
  onToggle: (championId: number) => void;
  maxSelect: number;
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
          const disabled = !selected && selectedIds.length >= maxSelect;
          return (
            <button
              key={champ.id}
              type="button"
              disabled={disabled}
              className={`champion-tile${selected ? " champion-tile--selected" : ""}`}
              onClick={() => onToggle(champ.id)}
              title={champ.name}
            >
              <ChampionIcon src={champ.iconUrl} name={champ.name} />
              <span>{champ.name}</span>
            </button>
          );
        })}
        {filtered.length === 0 && <p className="empty-hint">검색 결과가 없습니다.</p>}
      </div>
    </div>
  );
}
