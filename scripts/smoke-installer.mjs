import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const root = await mkdtemp(path.join(tmpdir(), 'resolver-installer-live-'));
const dir = path.join(root, 'deployment');
const project = 'resolver-installer-' + process.pid;
const volume = project + '-resolver-data';
const media = process.argv.includes('--with-media');
const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex < 0 ? 'main' : process.argv[tagIndex + 1];
assert.ok(tag, '--tag requires an image tag');
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = 'http://127.0.0.1:' + port;
const compose = ['compose', '--project-directory', dir, '-p', project, '--env-file', path.join(dir, '.env'), '-f', path.join(dir, 'compose.yaml'), '-f', path.join(dir, 'compose.override.yaml')];
function run(command, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...extra }, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(command + ' exited ' + code)));
  });
}
let installed = false;
const blocker = project + '-port-blocker';
let blockerStarted = false;
try {
  if (media) {
    const image = 'ghcr.io/albert-li-sz/resolver-web:' + tag;
    await run('docker', ['pull', image]);
    await run('docker', ['run', '-d', '--name', blocker, '--no-healthcheck', '-p', '127.0.0.1:20004:9080', '--entrypoint', 'node', image, '-e', 'setTimeout(() => {}, 300000)']);
    blockerStarted = true;
    const failed = await run('bash', ['install.sh', '--dir', dir, '--port', String(port), '--bind', '127.0.0.1', '--project', project, '--tag', tag]).then(() => false, () => true);
    assert.equal(failed, true, 'occupied HLS port must stop installation before application startup');
    assert.deepEqual(await readdir(dir), [], 'failed preflight must leave a retryable empty directory');
    assert.equal(execFileSync('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project], { encoding: 'utf8' }).trim(), '');
    assert.throws(() => execFileSync('docker', ['volume', 'inspect', volume], { stdio: 'ignore' }));
    await run('docker', ['rm', '-f', blocker]);
    blockerStarted = false;
  }
  await run('bash', ['install.sh', 'install', '--dir', dir, '--port', String(port), '--bind', '127.0.0.1', '--project', project, '--tag', tag, '--yes', ...(media ? [] : ['--no-media'])]);
  installed = true;
  const originalEnv = await readFile(path.join(dir, '.env'), 'utf8');
  assert.match(originalEnv, /^MEDIA_PUBLIC_HOST=$/m, 'installation must not require a fixed IP or domain');
  const key = originalEnv.match(/^RESOLVER_ADMIN_KEY=(.*)$/m)[1];
  const env = { RESOLVER_ADMIN_KEY: key, RESOLVER_SMOKE_STATE: path.join(root, 'resolver.json'), PLATFORM_SMOKE_STATE: path.join(root, 'platform.json') };
  await run(process.execPath, ['scripts/smoke.mjs', base], env);
  await run(process.execPath, ['scripts/smoke-platform.mjs', base], env);
  const failure = await run('bash', [path.join(dir, 'manage.sh'), 'update', '--tag', 'installer-missing-' + process.pid]).then(() => false, () => true);
  assert.equal(failure, true, 'unavailable image must fail without stopping the application');
  assert.equal((await fetch(base + '/api/health')).ok, true);
  assert.equal(await readFile(path.join(dir, '.env'), 'utf8'), originalEnv);
  await run('bash', [path.join(dir, 'manage.sh'), 'update']);
  assert.equal(await readFile(path.join(dir, '.env'), 'utf8'), originalEnv);
  await run(process.execPath, ['scripts/smoke.mjs', base, 'verify-restart'], env);
  await run(process.execPath, ['scripts/smoke-platform.mjs', base, 'verify-restart'], env);
  const backups = await readdir(path.join(dir, 'backups'));
  assert.equal(backups.length, 1);
  const contents = execFileSync('tar', ['-tzf', path.join(dir, 'backups', backups[0], 'data.tar.gz')], { encoding: 'utf8' });
  assert.match(contents, /configs\.json/);
  assert.match(contents, /platform\//);
  const images = execFileSync('docker', [...compose, 'config', '--images'], { encoding: 'utf8' });
  assert.match(images, /resolver-web@sha256:/);
  if (media) assert.match(images, /resolver-web-media-worker@sha256:/);
  const config = JSON.parse(execFileSync('docker', [...compose, 'config', '--format', 'json'], { encoding: 'utf8' }));
  assert.equal(config.services.resolver.ports[0].target, 9080);
  if (media) {
    const ports = config.services.mediamtx.ports.map(p => `${p.published}/${p.protocol}`).sort();
    assert.deepEqual(ports, ['20001/tcp', '20002/tcp', '20003/udp', '20004/tcp', '20005/tcp', '20006/tcp', '20006/udp']);
    assert.ok(!config.services['media-worker'].ports, 'worker must remain internal');
  }
  await run('bash', [path.join(dir, 'uninstall.sh'), '--yes']);
  assert.equal(execFileSync('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project], { encoding: 'utf8' }).trim(), '');
  execFileSync('docker', ['volume', 'inspect', volume], { stdio: 'ignore' });
  assert.equal(await readFile(path.join(dir, '.env'), 'utf8'), originalEnv);
  await run('bash', [path.join(dir, 'manage.sh'), 'start']);
  await run(process.execPath, ['scripts/smoke.mjs', base, 'verify-restart'], env);
  await run(process.execPath, ['scripts/smoke-platform.mjs', base, 'verify-restart'], env);
  await run('bash', [path.join(dir, 'uninstall.sh'), '--yes', '--purge-data']);
  assert.throws(() => execFileSync('docker', ['volume', 'inspect', volume], { stdio: 'ignore' }));
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/installer-verification.json', JSON.stringify({ tag, media, install: true, update: true, portConflictPreflight: media, failedPullPreservesService: true, unchangedEnv: true, recovery: true, readableBackup: true, portLayout: 2, uninstallPreservesData: true, restartAfterUninstall: true, explicitPurge: true, checkedAt: new Date().toISOString() }, null, 2));
  console.log('PASS: installer, port layout, update, backup, uninstall, data recovery and explicit purge');
} finally {
  if (blockerStarted) await run('docker', ['rm', '-f', blocker]).catch(error => console.error(error.message));
  if (installed) await run('docker', [...compose, 'down']).catch(error => console.error(error.message));
  else if (await readFile(path.join(dir, '.install-state')).then(() => true, () => false)) {
    await run('docker', [...compose, 'down']).catch(error => console.error(error.message));
  }
  // Only this test's generated volume is removed, never an operator's deployment.
  try { execFileSync('docker', ['volume', 'rm', volume], { stdio: 'ignore' }); } catch {}
  await rm(root, { recursive: true, force: true });
}
