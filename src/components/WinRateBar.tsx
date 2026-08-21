export function WinRateBar({ rate, games }: { rate: number; games?: number }) {
  const pct = Math.round(rate * 1000) / 10;
  const level = pct >= 53 ? "good" : pct <= 47 ? "bad" : "neutral";
  return (
    <div className="winrate">
      <div className="winrate-track">
        <div
          className={`winrate-fill winrate-fill--${level}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="winrate-label">
        {pct.toFixed(1)}%{typeof games === "number" ? ` · ${games.toLocaleString()}게임` : ""}
      </span>
    </div>
  );
}
