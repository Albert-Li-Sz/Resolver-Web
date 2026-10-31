import test from 'node:test';
import assert from 'node:assert/strict';
import { imageTarget, workflowImageTarget } from '../scripts/image-target.mjs';

const revision = 'a'.repeat(40);
const version = '1.3.0';

test('manual main images have commit-specific tags and metadata', () => {
  assert.deepEqual(workflowImageTarget({ version, revision, event: 'workflow_dispatch', ref: 'refs/heads/main' }), {
    channel: 'main', tag: `sha-${revision}`, version: `main-${revision.slice(0, 12)}`,
  });
  for (const ref of ['refs/heads/other', 'refs/tags/v1.3.0']) {
    assert.throws(() => workflowImageTarget({ version, revision, event: 'workflow_dispatch', ref }), /must use main/);
  }
});

test('stable publishing still requires a matching version tag', () => {
  assert.deepEqual(workflowImageTarget({ version, revision, event: 'push', ref: 'refs/tags/v1.3.0' }), {
    channel: 'release', tag: 'v1.3.0', version,
  });
  for (const ref of ['refs/heads/main', 'refs/tags/v1.4.0']) {
    assert.throws(() => workflowImageTarget({ version, revision, event: 'push', ref }), /mismatch/);
  }
  assert.throws(() => workflowImageTarget({ version, revision, event: 'pull_request', ref: 'refs/heads/main' }), /unsupported/);
});

test('registry verification rejects mutable, mismatched and cross-channel tags', () => {
  for (const tag of ['main', 'latest', 'v1.3.0', `sha-${'b'.repeat(40)}`]) {
    assert.throws(() => imageTarget({ version, revision, channel: 'main', tag }), /does not match/);
  }
  assert.throws(() => imageTarget({ version, revision, tag: `sha-${revision}` }), /does not match/);
  assert.throws(() => imageTarget({ version, revision: 'bad', channel: 'main' }));
  assert.throws(() => imageTarget({ version, revision, channel: 'anything' }), /unknown/);
});
