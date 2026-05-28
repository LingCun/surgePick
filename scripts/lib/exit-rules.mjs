/**
 * Evaluate exit gates against a position state.
 * Inputs:
 *   close        current close
 *   avgCost      average cost basis
 *   peak         max close since first buy
 *   isBear       bear regime flag at this date for the position's market
 *   holdingDays  calendar days since first buy
 * Returns { fire: bool, reason: 'catastrophe'|'trailing'|'trailing-tight'|'bear-flip'|'time-stop'|null }
 * Priority (first match wins): catastrophe > trailing-tight > trailing > bear-flip > time-stop.
 */
export function evaluateExit({ close, avgCost, peak, isBear, holdingDays }) {
  // 1. catastrophe — close < avgCost * 0.90
  if (close < avgCost * 0.90) {
    return { fire: true, reason: 'catastrophe' };
  }
  // gain measured against avgCost (realistic, since DCA averaged in)
  const gain = (peak - avgCost) / avgCost;
  // 3. tight trailing (must check before plain trailing — tighter band fires first when both apply)
  if (gain >= 0.20 && close < peak * 0.96) {
    return { fire: true, reason: 'trailing-tight' };
  }
  // 2. plain trailing (tuning F: -8% → -15%, let winners breathe)
  if (close < peak * 0.85) {
    return { fire: true, reason: 'trailing' };
  }
  // 4. bear flip
  if (isBear) {
    return { fire: true, reason: 'bear-flip' };
  }
  // 5. time stop disabled (tuning F: let winners run, only bear-flip forces exit)
  return { fire: false, reason: null };
}
