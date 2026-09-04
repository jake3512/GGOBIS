// Shared pick-recommendation ranking weights — how much real scraped win
// rate is allowed to be nudged by the two secondary heuristic signals
// (enemy-comp fit / ally-synergy fit). Used across every pick-recommendation
// surface in this app: pickadvice's counterPicks/synergyPicks/compFitPicks/
// combinedPicks (src/app/api/pickadvice/route.ts) and compcompare's
// likelyEnemyLaners (src/app/api/compcompare/route.ts, renormalized there
// since that tab has no ally-synergy signal — see its own weight constants).
//
// Previously each route defined its own copy of this ratio: compcompare had
// separate CANDIDATE_REAL_WEIGHT(0.8)/CANDIDATE_ENEMY_FIT_WEIGHT(0.2)
// literals hand-tuned to approximate the same ~4:1 real:enemyFit ratio these
// two already imply (0.65/0.15 ≈ 4.33), with nothing guaranteeing the two
// stayed in sync if one got tuned later ("모든 픽추천 로직을 발전시켜줘" —
// treated as one system, not four independently-tuned ones). Moved here as
// the single source of truth.
//
// Real data stays dominant (PICK_REAL_WEIGHT) — the other two can only nudge
// order among close candidates, never flip a clear real-win-rate edge.
export const PICK_REAL_WEIGHT = 0.65;
export const PICK_ENEMY_FIT_WEIGHT = 0.15;
export const PICK_ALLY_SYNERGY_WEIGHT = 0.2;
