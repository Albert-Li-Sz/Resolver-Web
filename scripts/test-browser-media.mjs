import { spawn } from 'node:child_process';
const project = `resolver-browser-media-${process.pid}`;
const compose = ['compose', '-p', project, '-f', 'tests/browser/compose.media.yaml'];
function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', args, { stdio: 'inherit' });
    p.once('error', reject); p.once('exit', code => code === 0 ? resolve() : reject(Error(`Media regression exited ${code}`)));
  });
}
try {
  await run([...compose, 'up', '-d', '--build', 'resolver', 'mediamtx', 'media-worker']);
  await run([...compose, 'up', '-d', 'fixture']);
  await run([...compose, 'run', '--rm', '--no-deps', 'browser', 'npx', 'playwright', 'test', 'tests/browser/media.spec.ts']);
} catch (e) {
  process.exitCode = 1;
  console.error(e.message);
  await run([...compose, 'logs', '--tail', '80', 'resolver', 'media-worker', 'mediamtx']).catch(() => {});
} finally {
  await run([...compose, 'down', '--volumes', '--remove-orphans']).catch(() => { process.exitCode = 1; });
}
