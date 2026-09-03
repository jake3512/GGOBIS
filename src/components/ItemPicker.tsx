"use client";

import { useMemo, useState } from "react";
import { ChampionIcon } from "@/components/ChampionIcon";
import { ITEM_STAT_CATEGORIES } from "@/lib/itemStats";

export interface ItemSummary {
  id: number;
  name: string;
  iconUrl: string;
  tags: string[];
  cost: { base: number; total: number; sell: number };
  /** Stat keys normalized onto Data Dragon's old "Flat*Mod"/"Percent*Mod"
   * style — see src/lib/sources/communityDragonItems.ts's CD_STAT_KEY_MAP,
   * the actual (Community Dragon-only) source of this data now. */
  stats: Record<string, number>;
  plainDescription: string;
}

/** Item search + "스탯 종류별로" 필터를 가진 아이템 선택 창 — ChampionPicker와
 * 같은 구조(검색창 + 그리드)이지만, 이름 검색 위에 스탯 카테고리 칩 한 줄이
 * 추가로 있다. 칩은 단일 선택(같은 칩을 다시 누르면 해제) — 실제 상점의
 * 카테고리 탭처럼 "이 스탯을 주는 아이템만" 한 번에 하나씩 좁혀보는 용도.
 * 이미 빌드에 들어있는 아이템도 계속 고를 수 있게 뒀다(같은 아이템 여러
 * 개를 사는 것 자체가 실제로도 막혀있지 않은 소모품/스택형 아이템이
 * 있어서) — selectedIds는 체크 표시용일 뿐 선택을 막지 않는다. */
export function ItemPicker({
  items,
  selectedIds,
  onSelect,
}: {
  items: ItemSummary[];
  selectedIds: number[];
  onSelect: (itemId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [statFilter, setStatFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (q && !it.name.toLowerCase().includes(q)) return false;
      if (statFilter && !(it.stats[statFilter] && it.stats[statFilter] !== 0)) return false;
      return true;
    });
  }, [items, query, statFilter]);

  return (
    <div className="champion-picker">
      <div className="item-stat-filter-row">
        <button
          type="button"
          className={statFilter === null ? "tab tab--active" : "tab"}
          onClick={() => setStatFilter(null)}
        >
          전체
        </button>
        {ITEM_STAT_CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            className={statFilter === c.key ? "tab tab--active" : "tab"}
            onClick={() => setStatFilter(statFilter === c.key ? null : c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="아이템 이름 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="champion-search"
      />
      <div className="champion-grid">
        {filtered.map((item) => {
          const selected = selectedIds.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={`champion-tile${selected ? " champion-tile--selected" : ""}`}
              onClick={() => onSelect(item.id)}
              title={item.name}
            >
              <ChampionIcon src={item.iconUrl} name={item.name} className="item-tile-icon" />
              <span>{item.name}</span>
              <span className="item-tile-price">{item.cost.total.toLocaleString()}골드</span>
            </button>
          );
        })}
        {filtered.length === 0 && <p className="empty-hint">검색 결과가 없습니다.</p>}
      </div>
    </div>
  );
}
