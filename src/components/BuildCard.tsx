import type { BuildResult, IconRef } from "@/lib/buildRefs";

export type { BuildResult };

function Rate({ rate, games }: { rate: number | null; games: number | null }) {
  if (rate === null) return null;
  return (
    <span className="build-rate">
      {(rate * 100).toFixed(1)}%{games !== null ? ` · ${games.toLocaleString()}게임` : ""}
    </span>
  );
}

function IconRow({ items, size = 32 }: { items: IconRef[]; size?: number }) {
  if (items.length === 0) return <span className="empty-hint">데이터 없음</span>;
  return (
    <div className="build-icon-row">
      {items.map((it, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- external CDN icons, no next/image domain config needed
        <img key={`${it.id}-${i}`} src={it.iconUrl} alt={it.name} title={it.name} width={size} height={size} referrerPolicy="no-referrer" />
      ))}
    </div>
  );
}

/** Condensed one-line version for pick-advice's top-N candidate rows —
 * keystone + core items + spells only, no skill order/full breakdown. */
export function BuildCardCompact({ build }: { build: BuildResult }) {
  const keystone = build.mainRunes[0];
  return (
    <div className="build-icon-row build-icon-row--compact">
      {keystone && (
        // eslint-disable-next-line @next/next/no-img-element -- external CDN icons, no next/image domain config needed
        <img src={keystone.iconUrl} alt={keystone.name} title={keystone.name} width={22} height={22} referrerPolicy="no-referrer" />
      )}
      {[build.spell1, build.spell2]
        .filter((s): s is IconRef => s !== null)
        .map((s) => (
          // eslint-disable-next-line @next/next/no-img-element -- external CDN icons, no next/image domain config needed
          <img key={s.id} src={s.iconUrl} alt={s.name} title={s.name} width={20} height={20} referrerPolicy="no-referrer" />
        ))}
      {build.coreItems.map((it) => (
        // eslint-disable-next-line @next/next/no-img-element -- external CDN icons, no next/image domain config needed
        <img key={it.id} src={it.iconUrl} alt={it.name} title={it.name} width={22} height={22} referrerPolicy="no-referrer" />
      ))}
      {build.coreWinRate !== null && (
        <span className="build-rate">핵심 아이템 {(build.coreWinRate * 100).toFixed(1)}%</span>
      )}
    </div>
  );
}

/** 소스 하나의 빌드 추천(아이템/룬/스펠/스킬 순서) — 라인 카운터/픽 추천/빌드
 * 탭에서 공통으로 쓰는 카드. 여러 소스와 블렌딩되는 값이 아니라
 * `sourceLabel` 하나의 값이라는 걸 항상 헤더에 명시한다. */
export function BuildCard({ build, sourceLabel = "lol.ps" }: { build: BuildResult; sourceLabel?: string }) {
  return (
    <div className="build-card">
      <p className="empty-hint">{sourceLabel} 기준 가장 인기 있는 빌드입니다 (다른 소스와 합산된 값이 아님).</p>

      <div className="build-section">
        <h4>룬</h4>
        <div className="build-icon-row">
          {build.mainRuneTree && (
            // eslint-disable-next-line @next/next/no-img-element -- external CDN icons, no next/image domain config needed
            <img src={build.mainRuneTree.iconUrl} alt={build.mainRuneTree.name} title={build.mainRuneTree.name} width={28} height={28} referrerPolicy="no-referrer" />
          )}
          {build.mainRunes.map((r) => (
            // eslint-disable-next-line @next/next/no-img-element -- external CDN icons, no next/image domain config needed
            <img key={r.id} src={r.iconUrl} alt={r.name} title={r.name} width={32} height={32} referrerPolicy="no-referrer" />
          ))}
          <span className="build-divider" />
          {build.subRuneTree && (
            // eslint-disable-next-line @next/next/no-img-element -- external CDN icons, no next/image domain config needed
            <img src={build.subRuneTree.iconUrl} alt={build.subRuneTree.name} title={build.subRuneTree.name} width={22} height={22} referrerPolicy="no-referrer" />
          )}
          {build.subRunes.map((r) => (
            // eslint-disable-next-line @next/next/no-img-element -- external CDN icons, no next/image domain config needed
            <img key={r.id} src={r.iconUrl} alt={r.name} title={r.name} width={26} height={26} referrerPolicy="no-referrer" />
          ))}
        </div>
        <Rate rate={build.runeWinRate} games={build.runeGames} />
      </div>

      <div className="build-section">
        <h4>스펠</h4>
        <IconRow items={[build.spell1, build.spell2].filter((s): s is IconRef => s !== null)} />
      </div>

      <div className="build-section">
        <h4>시작 아이템</h4>
        <IconRow items={build.startingItems} />
        <Rate rate={build.startingWinRate} games={build.startingGames} />
      </div>

      <div className="build-section">
        <h4>핵심 아이템</h4>
        <IconRow items={build.coreItems} />
        <Rate rate={build.coreWinRate} games={build.coreGames} />
      </div>

      <div className="build-section">
        <h4>전체 빌드 순서</h4>
        <IconRow items={build.shoes ? [...build.fullBuildItems, build.shoes] : build.fullBuildItems} />
      </div>

      <div className="build-section">
        <h4>스킬 마스터리 순서</h4>
        <p className="build-skill-order">{build.skillMaxOrder.join(" → ") || "데이터 없음"}</p>
        <Rate rate={build.skillMaxWinRate} games={build.skillMaxGames} />
      </div>

      <div className="build-section">
        <h4>레벨별 스킬업 순서 (1~15)</h4>
        <p className="build-skill-order">{build.skillLevelOrder.join(" ") || "데이터 없음"}</p>
      </div>
    </div>
  );
}
