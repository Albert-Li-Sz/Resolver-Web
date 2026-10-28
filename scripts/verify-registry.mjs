import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
const image = options.image || 'ghcr.io/albert-li-sz/resolver-web';
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const tag = options.tag || `v${version}`;
assert.match(image, /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/);
assert.match(options.revision || '', /^[a-f0-9]{40}$/);
assert.equal(tag, `v${version}`);
const repository = image.slice('ghcr.io/'.length);
const sha = (body) => `sha256:${createHash('sha256').update(body).digest('hex')}`;
const accept = 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json';
async function request(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Anonymous registry request failed: HTTP ${response.status} (${new URL(url).pathname})`);
  return response;
}
// No Docker credentials, GitHub token or personal access token is used here.
const auth = await (await request(`https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${repository}:pull`)}`)).json();
assert.ok(auth.token || auth.access_token, 'anonymous registry token is missing');
const headers = { Authorization: `Bearer ${auth.token || auth.access_token}`, Accept: accept };
async function object(kind, reference) {
  const response = await request(`https://ghcr.io/v2/${repository}/${kind}/${reference}`, headers);
  const body = Buffer.from(await response.arrayBuffer());
  const digest = sha(body);
  if (reference.startsWith('sha256:')) assert.equal(digest, reference);
  if (response.headers.get('docker-content-digest')) assert.equal(digest, response.headers.get('docker-content-digest'));
  return { value: JSON.parse(body), digest };
}
const index = await object('manifests', tag);
assert.ok(Array.isArray(index.value.manifests), 'release must be a multi-platform index');
const platforms = index.value.manifests.filter((item) => item.platform?.os === 'linux');
assert.deepEqual(platforms.map((item) => item.platform.architecture).sort(), ['amd64', 'arm64']);
const report = { image, version, tag, revision: options.revision, digest: index.digest, platforms: {} };
for (const platform of platforms) {
  const { value: manifest } = await object('manifests', platform.digest);
  const { value: config } = await object('blobs', manifest.config.digest);
  assert.equal(config.os, 'linux');
  assert.equal(config.architecture, platform.platform.architecture);
  assert.equal(config.config.Labels['org.opencontainers.image.revision'], options.revision);
  assert.equal(config.config.Labels['org.opencontainers.image.version'], version);
  assert.equal(config.config.User, 'node');
  report.platforms[`linux/${config.architecture}`] = platform.digest;
}
for (const alias of (options.aliases || '').split(',').filter(Boolean)) {
  assert.equal((await object('manifests', alias)).digest, report.digest, `${alias} must refer to the validated release`);
}
if (options.output) {
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, JSON.stringify(report, null, 2) + '\n');
}
console.log(`PASS: anonymous ${image}:${tag}; amd64 + arm64; revision ${options.revision}; ${report.digest}`);
