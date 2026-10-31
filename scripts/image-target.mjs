import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function imageTarget({ version, revision, channel = 'release', tag }) {
  assert.match(revision || '', /^[a-f0-9]{40}$/);
  assert.ok(channel === 'main' || channel === 'release', 'unknown image channel');
  const expectedTag = channel === 'main' ? `sha-${revision}` : `v${version}`;
  if (channel === 'release') assert.match(version || '', /^\d+\.\d+\.\d+$/);
  assert.equal(tag ?? expectedTag, expectedTag, 'image tag does not match its source');
  return {
    channel,
    tag: expectedTag,
    version: channel === 'main' ? `main-${revision.slice(0, 12)}` : version,
  };
}

export function workflowImageTarget({ version, revision, event, ref }) {
  if (event === 'workflow_dispatch') {
    assert.equal(ref, 'refs/heads/main', 'manual image builds must use main');
    return imageTarget({ version, revision, channel: 'main' });
  }
  assert.equal(event, 'push', 'unsupported image build event');
  assert.equal(ref, `refs/tags/v${version}`, 'release tag/package version mismatch');
  return imageTarget({ version, revision });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const target = workflowImageTarget({ version, revision: process.env.GITHUB_SHA, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF });
  const repository = (process.env.GITHUB_REPOSITORY || '').toLowerCase();
  assert.match(repository, /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/);
  assert.ok(process.env.GITHUB_ENV, 'GITHUB_ENV is required');
  await appendFile(process.env.GITHUB_ENV, `IMAGE=ghcr.io/${repository}\nIMAGE_CHANNEL=${target.channel}\nVERSION=${target.version}\nRELEASE_TAG=${target.tag}\n`);
  console.log(`Image channel: ${target.channel}; tag: ${target.tag}; version: ${target.version}`);
}
