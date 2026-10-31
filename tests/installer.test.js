import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const installer = path.resolve('install.sh');
const mockDocker = [
  '#!/usr/bin/env node',
  "const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');",
  "const args=process.argv.slice(2), standalone=path.basename(process.argv[1])==='docker-compose';",
  "const root=process.env.INSTALL_TEST_ROOT,file=path.join(root,'engine.json');",
  "let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)): {running:false,volumes:[],upAttempts:0};",
  "const save=()=>fs.writeFileSync(file,JSON.stringify(state));",
  "fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify({standalone,args,admin:process.env.RESOLVER_ADMIN_KEY,profile:process.env.COMPOSE_PROFILES})+'\\n');",
  "if(args[0]==='info')process.exit(0);",
  "if(args[0]==='compose'||standalone){",
  " const a=standalone?args:args.slice(1);",
  " if(a[0]==='version'){if(!standalone&&process.env.INSTALL_TEST_STANDALONE)process.exit(1);console.log('2.30.0');process.exit(0);}",
  " if(a.includes('--help')){console.log('--wait-timeout');process.exit(0);}",
  " const command=a.find(x=>['up','stop','ps','config','logs','down'].includes(x));",
  " if(command==='up'){state.upAttempts++;if(process.env.INSTALL_TEST_FAIL_UP&&state.upAttempts===Number(process.env.INSTALL_TEST_FAIL_UP)){save();process.exit(1);}state.running=true;save();}",
  " if(command==='stop'||command==='down'){state.running=false;save();}",
  " if(command==='ps'&&state.running)console.log('test-container');",
  " process.exit(0);",
  "}",
  "if(args[0]==='ps')process.exit(0);",
  "if(args[0]==='create'){state.probe=args;save();console.log('installer-port-probe');process.exit(0);}",
  "if(args[0]==='start'){if(process.env.INSTALL_TEST_BUSY_PORT&&state.probe.some(a=>a.includes(':'+process.env.INSTALL_TEST_BUSY_PORT+':'))){console.error('failed to bind host port 0.0.0.0:'+process.env.INSTALL_TEST_BUSY_PORT+'/tcp: address already in use');process.exit(1);}process.exit(0);}",
  "if(args[0]==='rm'){delete state.probe;save();process.exit(0);}",
  "if(args[0]==='pull'){if(process.env.INSTALL_TEST_FAIL_PULL)process.exit(1);process.exit(0);}",
  "if(args[0]==='image'&&args[1]==='inspect'){",
  " if(args.at(-1).includes('io.resolver.network-layout')){console.log(process.env.INSTALL_TEST_LAYOUT||'2');process.exit(0);}",
  " const image=args[2],revision=(process.env.INSTALL_TEST_REVISION||'c').repeat(40);",
  " if(args.at(-1).includes('RepoDigests')){const repo=image.slice(0,image.lastIndexOf(':'));console.log(repo+'@sha256:'+crypto.createHash('sha256').update(image+revision).digest('hex'));}",
  " else console.log(image.includes('media-worker')&&process.env.INSTALL_TEST_MISMATCH?'d'.repeat(40):revision);",
  " process.exit(0);",
  "}",
  "if(args[0]==='volume'){const name=args[2];if(args[1]==='inspect')process.exit(state.volumes.includes(name)?0:1);if(args[1]==='create'){state.volumes.push(name);save();process.exit(0);}if(args[1]==='rm'){state.volumes=state.volumes.filter(v=>v!==name);save();process.exit(0);}throw Error('Unexpected volume command');}",
  "if(args[0]==='run'){if(process.env.INSTALL_TEST_FAIL_BACKUP)process.exit(1);process.stdout.write('test-volume-archive');process.exit(0);}",
  "throw Error('Unexpected Docker command: '+args.join(' '));",
].join('\n');

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'resolver-installer-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const dir = path.join(root, 'installation with spaces');
  await mkdir(bin);
  for (const name of ['docker', 'docker-compose']) {
    await writeFile(path.join(bin, name), mockDocker);
    await chmod(path.join(bin, name), 0o755);
  }
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, INSTALL_TEST_ROOT: root, ...options };
  const invoke = (args, extra = {}, script = installer) => spawnSync('bash', [script, ...args, '--dir', dir], { encoding: 'utf8', env: { ...env, ...extra }, timeout: 15000 });
  const install = (...args) => invoke(['install', '--host', '192.168.1.10', '--project', 'installer-test', '--yes', ...args]);
  const calls = async () => (await readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const state = async () => JSON.parse(await readFile(path.join(root, 'engine.json'), 'utf8'));
  return { root, dir, env, invoke, install, calls, state };
}

test('standalone installer creates a complete Compose deployment with protected keys and matching pinned images', async t => {
  const f = await fixture(t);
  const result = f.install();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /安装完成：监听 0\.0\.0\.0:9080/);
  const env = await readFile(path.join(f.dir, '.env'), 'utf8');
  const admin = env.match(/^RESOLVER_ADMIN_KEY=([a-f0-9]{64})$/m)?.[1];
  const internal = env.match(/^MEDIA_INTERNAL_KEY=([a-f0-9]{64})$/m)?.[1];
  assert.ok(admin && internal && admin !== internal);
  assert.ok(!result.stdout.includes(admin));
  const lock = await readFile(path.join(f.dir, 'compose.override.yaml'), 'utf8');
  assert.equal((lock.match(/@sha256:/g) || []).length, 3);
  const config = await readFile(path.join(f.dir, 'compose.yaml'), 'utf8');
  assert.match(config, /external: true/);
  assert.match(config, /installer-test-resolver-data/);
  assert.doesNotMatch(config, /\bbuild:/);
  assert.deepEqual(await readFile(path.join(f.dir, 'deploy/mediamtx.yml')), await readFile('deploy/mediamtx.yml'));
  assert.deepEqual(await readFile(path.join(f.dir, 'manage.sh')), await readFile(installer));
  assert.equal((await f.state()).running, true);
  assert.equal(f.install().status, 0);
  assert.equal(await readFile(path.join(f.dir, '.env'), 'utf8'), env);
});

test('update backs up data and preserves exact configuration, identity and Docker volume', async t => {
  const f = await fixture(t);
  assert.equal(f.install('--no-media').status, 0);
  const sentinel = path.join(f.root, 'must-not-exist');
  const envPath = path.join(f.dir, '.env');
  const env = (await readFile(envPath, 'utf8')) + "\nUNUSED='$(touch " + sentinel + ")'\n# custom setting\n";
  await writeFile(envPath, env);
  const oldLock = await readFile(path.join(f.dir, 'compose.override.yaml'), 'utf8');
  const result = f.invoke(['update', '--tag', 'sha-' + 'b'.repeat(40)], { INSTALL_TEST_REVISION: 'b', RESOLVER_ADMIN_KEY: 'ambient-must-not-override' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(await readFile(envPath, 'utf8'), env);
  assert.notEqual(await readFile(path.join(f.dir, 'compose.override.yaml'), 'utf8'), oldLock);
  assert.match(await readFile(path.join(f.dir, '.install-state'), 'utf8'), /CHANNEL=sha-b{40}/);
  assert.deepEqual((await f.state()).volumes, ['installer-test-resolver-data']);
  const backups = await readdir(path.join(f.dir, 'backups'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(f.dir, 'backups', backups[0], '.env'), 'utf8'), env);
  assert.equal(await readFile(path.join(f.dir, 'backups', backups[0], 'data.tar.gz'), 'utf8'), 'test-volume-archive');
  await assert.rejects(readFile(sentinel), /ENOENT/);
  const calls = await f.calls();
  assert.ok(calls.filter(c => c.args[0] === 'compose' && c.args.includes('-p')).every(c => c.admin === undefined));
  assert.ok(calls.some(c => c.args[0] === 'run' && c.args.includes('installer-test-resolver-data:/data:ro')));
  assert.ok(!calls.some(c => c.args.includes('down') || c.args.includes('prune') || (c.args[0] === 'volume' && c.args[1] === 'rm')));
});

test('pull failure and mismatched media revisions leave an existing deployment running', async t => {
  const f = await fixture(t);
  assert.equal(f.install().status, 0);
  const old = await readFile(path.join(f.dir, 'compose.override.yaml'), 'utf8');
  for (const injected of [{ INSTALL_TEST_FAIL_PULL: '1' }, { INSTALL_TEST_MISMATCH: '1' }]) {
    const before = (await f.calls()).length;
    const result = f.invoke(['update'], injected);
    assert.notEqual(result.status, 0);
    assert.equal((await f.state()).running, true);
    assert.equal(await readFile(path.join(f.dir, 'compose.override.yaml'), 'utf8'), old);
    assert.ok(!(await f.calls()).slice(before).some(c => c.args.includes('stop')));
  }
});

test('failed health check restores previous image pins and update channel without overwriting data', async t => {
  const f = await fixture(t);
  assert.equal(f.install().status, 0);
  const oldLock = await readFile(path.join(f.dir, 'compose.override.yaml'), 'utf8');
  const oldState = await readFile(path.join(f.dir, '.install-state'), 'utf8');
  const result = f.invoke(['update', '--tag', 'candidate'], { INSTALL_TEST_REVISION: 'b', INSTALL_TEST_FAIL_UP: '2' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /原镜像已恢复/);
  assert.equal((await f.state()).running, true);
  assert.equal(await readFile(path.join(f.dir, 'compose.override.yaml'), 'utf8'), oldLock);
  assert.equal(await readFile(path.join(f.dir, '.install-state'), 'utf8'), oldState);
  assert.ok((await f.calls()).filter(c => c.args[0] === 'run').every(c => c.args.includes('installer-test-resolver-data:/data:ro')));
});

test('backup failure restarts the old application and does not apply new images', async t => {
  const f = await fixture(t);
  assert.equal(f.install('--no-media').status, 0);
  const old = await readFile(path.join(f.dir, 'compose.override.yaml'), 'utf8');
  const result = f.invoke(['update'], { INSTALL_TEST_FAIL_BACKUP: '1' });
  assert.notEqual(result.status, 0);
  assert.equal((await f.state()).running, true);
  assert.equal(await readFile(path.join(f.dir, 'compose.override.yaml'), 'utf8'), old);
});

test('directory lock blocks concurrent changes; unmanaged directories are never overwritten', async t => {
  const f = await fixture(t);
  await mkdir(f.dir);
  await writeFile(path.join(f.dir, '.env'), 'EXISTING=keep\n');
  assert.notEqual(f.install().status, 0);
  assert.equal(await readFile(path.join(f.dir, '.env'), 'utf8'), 'EXISTING=keep\n');
  await rm(f.dir, { recursive: true });
  assert.equal(f.install('--no-media').status, 0);
  await mkdir(path.join(f.dir, '.install-lock'));
  const before = (await f.calls()).length;
  assert.notEqual(f.invoke(['update']).status, 0);
  assert.ok(!(await f.calls()).slice(before).some(c => c.args.includes('pull') || c.args.includes('stop')));
});

test('new standalone docker-compose fallback and installed manager default directory work', async t => {
  const f = await fixture(t, { INSTALL_TEST_STANDALONE: '1' });
  assert.equal(f.install('--no-media').status, 0);
  const status = spawnSync('bash', [path.join(f.dir, 'manage.sh'), 'status'], { cwd: f.root, env: f.env, encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(f.invoke(['stop'], {}, path.join(f.dir, 'manage.sh')).status, 0);
  assert.equal((await f.state()).running, false);
  assert.equal(f.invoke(['backup']).status, 0);
  assert.equal((await f.state()).running, false, 'backup must not start an intentionally stopped service');
  assert.equal(f.invoke(['start']).status, 0);
  assert.equal((await f.state()).running, true);
  assert.ok((await f.calls()).some(c => c.standalone && c.args.includes('up')));
});

test('invalid host, port and project input never pulls images or starts containers', async t => {
  const f = await fixture(t);
  for (const args of [
    ['--host', '999.1.1.1'], ['--bind', '127.0.0.999'], ['--port', '70000'],
    ['--host', 'http://example.com'], ['--project', 'unsafe;command'],
  ]) assert.notEqual(f.install(...args).status, 0, args.join(' '));
  assert.ok(!(await f.calls()).some(c => c.args[0] === 'pull' || c.args.includes('up') && !c.args.includes('--help')));
});

test('default installation binds all interfaces and requires no fixed IP or domain', async t => {
  const f = await fixture(t);
  const result = f.invoke(['install', '--no-media', '--yes', '--project', 'installer-test']);
  assert.equal(result.status, 0, result.stderr);
  const env = await readFile(path.join(f.dir, '.env'), 'utf8');
  assert.match(env, /^RESOLVER_BIND_ADDRESS=0\.0\.0\.0$/m);
  assert.match(env, /^RESOLVER_PORT=9080$/m);
  assert.match(env, /^MEDIA_PUBLIC_HOST=$/m);
  assert.match(env, /^RESOLVER_NETWORK_POLICY=open$/m);
  const config = await readFile(path.join(f.dir, 'compose.yaml'), 'utf8');
  assert.match(config, /MEDIA_BROWSER_BASE: \$\{MEDIA_BROWSER_BASE:-\}/);
  assert.doesNotMatch(config, /http:\/\/192\.168/);
});

test('occupied media ports are detected before deployment and an empty installation can be retried', async t => {
  const f = await fixture(t);
  const result = f.invoke(['install', '--project', 'installer-test'], { INSTALL_TEST_BUSY_PORT: '20004' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /20004/);
  assert.match(result.stderr, /端口/);
  assert.deepEqual(await readdir(f.dir), []);
  assert.ok(!(await f.calls()).some(c => c.args.includes('up') && !c.args.includes('--help')));
  assert.equal((await f.state()).probe, undefined, 'probe container must be removed after failure');
  assert.equal(f.install().status, 0);
});

async function oldInstallation(f, customPort = '4173') {
  assert.equal(f.install().status, 0);
  for (const [name, destination] of [['compose.yaml', 'compose.yaml'], ['mediamtx.yml', 'deploy/mediamtx.yml']]) {
    await writeFile(path.join(f.dir, destination), await readFile('tests/fixtures/installer-9ca5696/' + name));
  }
  const envFile = path.join(f.dir, '.env');
  const env = (await readFile(envFile, 'utf8')).replace(/^RESOLVER_PORT=.*$/m, 'RESOLVER_PORT=' + customPort) + '\n# operator custom setting\nCUSTOM=preserved\n';
  await writeFile(envFile, env);
  return env;
}

test('legacy install port migration updates the web, worker, gateway and links as one deployment', async t => {
  const f = await fixture(t);
  const oldEnv = await oldInstallation(f);
  const result = f.invoke(['update']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(await readFile(path.join(f.dir, '.env'), 'utf8'), oldEnv.replace('RESOLVER_PORT=4173', 'RESOLVER_PORT=9080'));
  const config = await readFile(path.join(f.dir, 'compose.yaml'), 'utf8');
  assert.doesNotMatch(config, /:4173|PORT: 4173|:8091|:8554|:1935|:8890|:8888|:8889|:8189/);
  assert.match(config, /MEDIA_HLS_PORT:-20004/);
  assert.deepEqual(await readFile(path.join(f.dir, 'deploy/mediamtx.yml')), await readFile('deploy/mediamtx.yml'));
  const backup = (await readdir(path.join(f.dir, 'backups')))[0];
  assert.equal(await readFile(path.join(f.dir, 'backups', backup, '.env'), 'utf8'), oldEnv);
});

test('legacy port migration preserves a custom web port and restores all original files on failure', async t => {
  const f = await fixture(t);
  const oldEnv = await oldInstallation(f, '18080');
  const oldGateway = await readFile(path.join(f.dir, 'deploy/mediamtx.yml'));
  const oldCompose = await readFile(path.join(f.dir, 'compose.yaml'));
  const result = f.invoke(['update'], { INSTALL_TEST_FAIL_UP: '2' });
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(path.join(f.dir, '.env'), 'utf8'), oldEnv);
  assert.deepEqual(await readFile(path.join(f.dir, 'deploy/mediamtx.yml')), oldGateway);
  assert.deepEqual(await readFile(path.join(f.dir, 'compose.yaml')), oldCompose);
  assert.equal(f.invoke(['update']).status, 0);
  assert.equal(await readFile(path.join(f.dir, '.env'), 'utf8'), oldEnv);
});

test('updating an original installer deployment migrates fixed media addresses while preserving custom settings', async t => {
  const f = await fixture(t);
  assert.equal(f.install().status, 0);
  const file = path.join(f.dir, 'compose.yaml');
  let config = await readFile(file, 'utf8');
  config = config.replace('MEDIA_PUBLIC_HOST: ${MEDIA_PUBLIC_HOST:-}', 'MEDIA_PUBLIC_HOST: ${MEDIA_PUBLIC_HOST:?请填写服务器地址}')
    .replace('MEDIA_BROWSER_BASE: ${MEDIA_BROWSER_BASE:-}', 'MEDIA_BROWSER_BASE: http://${MEDIA_PUBLIC_HOST}:8889')
    .replace('MEDIA_HLS_BASE: ${MEDIA_HLS_BASE:-}', 'MEDIA_HLS_BASE: http://${MEDIA_PUBLIC_HOST}:8888');
  config += '\n# operator custom setting\n';
  await writeFile(file, config);
  assert.equal(f.invoke(['update']).status, 0);
  const updated = await readFile(file, 'utf8');
  assert.match(updated, /MEDIA_BROWSER_BASE: \$\{MEDIA_BROWSER_BASE:-\}/);
  assert.match(updated, /# operator custom setting/);
  const backup = (await readdir(path.join(f.dir, 'backups')))[0];
  assert.equal(await readFile(path.join(f.dir, 'backups', backup, 'compose.yaml'), 'utf8'), config);
});

test('uninstall requires explicit confirmation and preserves data, configuration and image pins by default', async t => {
  const f = await fixture(t);
  assert.equal(f.install().status, 0);
  const env = await readFile(path.join(f.dir, '.env'));
  const lock = await readFile(path.join(f.dir, 'compose.override.yaml'));
  assert.notEqual(f.invoke(['uninstall']).status, 0);
  assert.equal((await f.state()).running, true);
  const result = spawnSync('bash', [path.join(f.dir, 'uninstall.sh'), '--yes'], { cwd: f.root, env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await f.state()).running, false);
  assert.deepEqual((await f.state()).volumes, ['installer-test-resolver-data']);
  assert.deepEqual(await readFile(path.join(f.dir, '.env')), env);
  assert.deepEqual(await readFile(path.join(f.dir, 'compose.override.yaml')), lock);
  const down = (await f.calls()).find(c => c.args.includes('down'));
  assert.ok(down.args.includes('installer-test'));
  assert.ok(!down.args.includes('--volumes') && !down.args.includes('--rmi'));
  assert.equal(f.invoke(['start']).status, 0);
  assert.equal((await f.state()).running, true);
});

test('purging removes only the recorded project volume after explicit opt-in', async t => {
  const f = await fixture(t);
  assert.equal(f.install().status, 0);
  assert.notEqual(f.invoke(['uninstall', '--purge-data']).status, 0);
  assert.notEqual(f.invoke(['update', '--purge-data', '--yes']).status, 0);
  assert.deepEqual((await f.state()).volumes, ['installer-test-resolver-data']);
  const purged = f.invoke(['uninstall', '--purge-data', '--yes']);
  assert.equal(purged.status, 0, purged.stderr);
  assert.match(purged.stdout, /已卸载并删除本项目赛事数据卷：installer-test-resolver-data。/);
  assert.deepEqual((await f.state()).volumes, []);
  const removals = (await f.calls()).filter(c => c.args[0] === 'volume' && c.args[1] === 'rm');
  assert.deepEqual(removals.map(c => c.args[2]), ['installer-test-resolver-data']);
  assert.equal(f.invoke(['uninstall', '--purge-data', '--yes']).status, 0, 'purging an already removed volume is idempotent');
});

test('older images cannot be started with the new port layout and custom media ports reach Compose', async t => {
  const f = await fixture(t);
  const result = f.invoke(['install'], { INSTALL_TEST_LAYOUT: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /尚不支持新版端口布局/);
  assert.deepEqual(await readdir(f.dir), []);
  assert.equal(f.install('--media-port-base', '20501').status, 0);
  const env = await readFile(path.join(f.dir, '.env'), 'utf8');
  assert.ok(/^MEDIA_RTSP_PORT=20501$/m.test(env));
  assert.ok(/^MEDIA_ICE_PORT=20506$/m.test(env));
  const probe = (await f.calls()).find(c => c.args[0] === 'create');
  assert.ok(probe.args.includes('0.0.0.0:20504:20504/tcp'));
  assert.ok(probe.args.includes('0.0.0.0:20506:20506/udp'));
});
