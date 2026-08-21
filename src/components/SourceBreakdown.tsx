interface SourceValue {
  sourceId: string;
  sourceLabel: string;
  winRate: number;
  games: number;
}

/** Small row of per-source badges (up to 3, largest sample first) shown
 * under a primary stat so users can see which sites agree/disagree instead
 * of trusting one blended number blindly. */
export function SourceBreakdown({ sources }: { sources: SourceValue[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="source-breakdown">
      {sources.map((s) => (
        <span key={s.sourceId} className="source-badge">
          {s.sourceLabel} {(s.winRate * 100).toFixed(1)}%
          <span className="source-badge-games">({s.games.toLocaleString()}게임)</span>
        </span>
      ))}
    </div>
  );
}
