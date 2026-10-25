import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { inputError } from './limits.js';

if (!isMainThread) {
  try {
    const engine = await import('./engine.js');
    const { task, args } = workerData;
    let value;
    if (task === 'parse') value = engine.parseEventFeed(args[0]);
    else if (task === 'game') value = engine.buildGame(...args);
    else if (task === 'awards') {
      const options = engine.normalizeOptions(args[1]);
      const { withFreezeOptions } = await import('../../public/js/freeze.js');
      const c = withFreezeOptions(engine.normalizeContest(args[0]), options);
      const final = engine.computeCells(c, { frozen: false });
      const { configuredAwards } = await import('../../public/js/medals.js');
      value = { awards: configuredAwards(final.contest, options, final.standings) };
    } else throw new Error('Unknown engine task');
    parentPort.postMessage({ value });
  } catch (err) {
    parentPort.postMessage({ error: { message: err.message, status: err.status, expose: err.expose } });
  }
}

let active = 0;
export function engineJob(task, ...args) {
  if (active >= 2) return Promise.reject(inputError('服务器正在处理赛事，请稍后重试', 503));
  active++;
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL(import.meta.url), { workerData: { task, args }, resourceLimits: { maxOldGenerationSizeMb: 256 } }); }
    catch (err) { active--; reject(err); return; }
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true; active--; clearTimeout(timer); worker.terminate();
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => finish(inputError('赛事处理超时，请缩小导入规模', 413)), 20_000);
    worker.once('message', ({ error, value }) => finish(error ? Object.assign(new Error(error.message), error) : null, value));
    worker.once('error', (err) => finish(err));
    worker.once('exit', (code) => { if (!settled) finish(new Error(`Engine worker exited: ${code}`)); });
  });
}
