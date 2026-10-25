/** Visible manual actions; shared by presenter and server validation. */
export function actionIndicesFor(steps) {
  const firstBoard = steps.findIndex((step) => step.type === 'presentation' && step.screen === 'scoreboard');
  return steps.flatMap((step, i) => {
    if (step.type === 'delay' || step.type === 'pause') return [];
    if (firstBoard >= 0 && i < firstBoard && step.type !== 'presentation') return [];
    return [i];
  });
}

export function startIndexFor(game) {
  const screen = game.options?.startScreen === 'scoreboard' ? 'scoreboard' : 'splash';
  const index = game.steps.findIndex((step) => step.type === 'presentation' && step.screen === screen);
  return index >= 0 ? index : (actionIndicesFor(game.steps)[0] ?? -1);
}
