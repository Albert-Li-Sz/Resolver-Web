/** Visible manual actions; shared by presenter and server validation. */
export function actionIndicesFor(steps) {
  const firstBoard = steps.findIndex((step) => step.type === 'presentation' && step.screen === 'scoreboard');
  return steps.flatMap((step, i) => {
    if (step.type === 'delay' || step.type === 'pause') return [];
    if (step.role === 'setup') return [];
    if (firstBoard >= 0 && i < firstBoard && step.type !== 'presentation') return [];
    return [i];
  });
}

export function startIndexFor(game) {
  const screen = game.options?.startScreen === 'scoreboard' ? 'scoreboard' : 'splash';
  const index = game.steps.findIndex((step) => step.type === 'presentation' && step.screen === screen);
  return index >= 0 ? index : (actionIndicesFor(game.steps)[0] ?? -1);
}

/** Reuse the engine's original pacing, accelerated fourfold for the prelude. */
export function fastForwardDelayFor(game, index, nextIndex) {
  const current = game.steps[index];
  if (current?.role === 'intro-bottom') return current.durationMs || 650;
  if (current?.role === 'manual-entry') return 80;
  let delay = 0;
  for (let i = index + 1; i < nextIndex; i++) {
    if (game.steps[i].type === 'delay') delay += game.steps[i].ms;
  }
  if (!delay) delay = current?.type === 'scroll' ? 160 : 400;
  const factor = Number(game.options?.speedFactor) || 1;
  return Math.max(16, Math.round(delay * factor / (current?.speedMultiplier || 1)));
}

export function nextAutomaticAction(game, actions, position) {
  const index = actions[position];
  const nextIndex = actions[position + 1];
  if (nextIndex == null) return null;
  const step = game.steps[index];
  const enteringManual = step?.role === 'manual-entry' && game.steps[nextIndex]?.type === 'selectTeam';
  if (step?.phase !== 'fast' && !enteringManual && !(step?.role === 'intro-bottom' && game.steps[nextIndex]?.phase === 'fast')) return null;
  return { index: nextIndex, delay: fastForwardDelayFor(game, index, nextIndex) };
}
