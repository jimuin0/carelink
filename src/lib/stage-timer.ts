/**
 * Records how long each stage of a server render took and logs only when the total is slow.
 * Logs stage names and milliseconds only: never identifiers, queries or provider messages.
 */
export function createStageTimer(tag: string, slowMs = 3000, now: () => number = Date.now) {
  let last = now();
  const stages: Record<string, number> = {};
  return {
    mark(stage: string) { const at = now(); stages[stage] = at - last; last = at; },
    finish() {
      const total = Object.values(stages).reduce((sum, ms) => sum + ms, 0);
      if (total >= slowMs) console.warn(`[${tag}] slow`, { ...stages, total });
      return total;
    },
  };
}
