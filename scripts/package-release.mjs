import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const version = JSON.parse(await readFile(new URL('package.json', root), 'utf8')).version;
const output = path.resolve(process.argv[2] || 'dist/release');
const digestFile = path.resolve(process.argv[3] || 'dist/image-digests.json');
const report = JSON.parse(await readFile(digestFile, 'utf8'));
assert.equal(report.version, version);
assert.equal(report.revision, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'resolver-release-'));
try {
  for (const file of ['compose.yaml', '.env.example', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    await copyFile(new URL(file, root), path.join(temporary, file));
  }
  await writeFile(path.join(temporary, 'README.md'), `# Resolver Web v${version}\n\n镜像由 GitHub Actions 构建，支持 linux/amd64 和 linux/arm64。\n\n1. 复制 .env.example 为 .env，设置 RESOLVER_ADMIN_KEY。局域网直连时将 RESOLVER_BIND_ADDRESS 改为 0.0.0.0。\n2. 执行 docker compose pull，再执行 docker compose up -d。\n3. 访问 http://服务器IP:4173/，用户名 admin，密码为 .env 中设置的值。观众入口为 /view。\n\n数据保存在 resolver-data 命名卷；升级请保留原项目名与数据卷。修改 .env 中的 RESOLVER_IMAGE_TAG 后重新 pull/up 即可。\n\n源码和完整说明：https://github.com/Albert-Li-Sz/Resolver-Web\n`);
  execFileSync('tar', ['-czf', path.join(output, `resolver-web-v${version}-deploy.tar.gz`), '-C', temporary, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  await copyFile(digestFile, path.join(output, 'image-digests.json'));
  await copyFile(new URL('doc/使用指南.pdf', root), path.join(output, `resolver-web-v${version}-guide.pdf`));
  await copyFile(new URL('examples/scoreboards.zip', root), path.join(output, `resolver-web-v${version}-examples.zip`));
  const files = (await readdir(output)).filter((name) => name !== 'SHA256SUMS').sort();
  const checksums = [];
  for (const name of files) checksums.push(`${createHash('sha256').update(await readFile(path.join(output, name))).digest('hex')}  ${name}`);
  await writeFile(path.join(output, 'SHA256SUMS'), checksums.join('\n') + '\n');
  console.log(`Release assets: ${output}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
