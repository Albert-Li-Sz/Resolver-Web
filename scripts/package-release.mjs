import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const version = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
).version;
const output = path.resolve(process.argv[2] || "dist/release");
const digestFile = path.resolve(process.argv[3] || "dist/image-digests.json");
const report = JSON.parse(await readFile(digestFile, "utf8"));
const mediaDigestFile = path.resolve(
  process.argv[4] || "dist/media-image-digests.json",
);
const mediaReport = JSON.parse(await readFile(mediaDigestFile, "utf8"));
assert.equal(mediaReport.version, report.version);
assert.equal(mediaReport.revision, report.revision);
assert.equal(mediaReport.image, report.image + "-media-worker");
assert.equal(report.version, version);
assert.equal(
  report.revision,
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
);
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), "resolver-release-"));
try {
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    await copyFile(new URL(file, root), path.join(temporary, file));
  }
  await mkdir(path.join(temporary, "deploy"), { recursive: true });
  await copyFile(
    new URL("deploy/mediamtx.yml", root),
    path.join(temporary, "deploy/mediamtx.yml"),
  );
  await copyFile(
    new URL("doc/PLATFORM.md", root),
    path.join(temporary, "GUIDE.md"),
  );
  for (const file of [
    "PLATFORM.md",
    "INSTALL.md",
    "NETWORK.md",
    "PLATFORM-VALIDATION.md",
    "platform-performance.json",
    "OLLAMA-VALIDATION.md",
    "ollama-pixel-comparison.json",
    "ollama-performance.json",
  ]) {
    await copyFile(new URL(`doc/${file}`, root), path.join(temporary, file));
  }
  await cp(
    new URL("doc/images/platform/", root),
    path.join(temporary, "images/platform"),
    { recursive: true },
  );
  await cp(
    new URL("doc/images/ollama/", root),
    path.join(temporary, "images/ollama"),
    { recursive: true },
  );
  const image = report.image;
  const compose = (
    await readFile(new URL("compose.platform.yaml", root), "utf8")
  )
    .split("\n")
    .filter((l) => !/^    build:/.test(l))
    .join("\n")
    .replace("resolver-web:platform-local", `${image}:v${version}`)
    .replace(
      "resolver-media-worker:platform-local",
      `${image}-media-worker:v${version}`,
    );
  await writeFile(path.join(temporary, "compose.yaml"), compose);
  await writeFile(
    path.join(temporary, ".env.example"),
    (await readFile(new URL("deploy/platform.env.example", root), "utf8"))
      .split("\n")
      .filter((line) => !/^(RESOLVER_IMAGE|MEDIA_WORKER_IMAGE)=/.test(line))
      .join("\n") +
      `\nRESOLVER_IMAGE=${image}:v${version}\nMEDIA_WORKER_IMAGE=${image}-media-worker:v${version}\n`,
  );
  await writeFile(
    path.join(temporary, "README.md"),
    `# ICPC 赛事制作台 v${version}\n\n1. 复制 .env.example 为 .env，填写两个密钥、服务器局域网 IP 及绑定地址。\n2. 执行 docker compose pull 和 docker compose up -d。\n3. 访问 http://服务器IP:9080/；管理端用户名 admin。\n\n完整使用说明见 GUIDE.md。升级保留原项目名、数据卷及管理员密码。旧版 .env 需补充 MEDIA_INTERNAL_KEY、MEDIA_PUBLIC_HOST；镜像可由 RESOLVER_IMAGE 和 MEDIA_WORKER_IMAGE 覆盖。\n`,
  );
  execFileSync(
    "tar",
    [
      "-czf",
      path.join(output, `resolver-web-v${version}-deploy.tar.gz`),
      "-C",
      temporary,
      ".",
    ],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  await copyFile(digestFile, path.join(output, "image-digests.json"));
  await copyFile(
    mediaDigestFile,
    path.join(output, "media-image-digests.json"),
  );
  await copyFile(
    new URL("doc/使用指南.pdf", root),
    path.join(output, "resolver-web-v1.3.0-resolver-guide.pdf"),
  );
  await copyFile(
    new URL("examples/scoreboards.zip", root),
    path.join(output, `resolver-web-v${version}-examples.zip`),
  );
  const files = (await readdir(output))
    .filter((name) => name !== "SHA256SUMS")
    .sort();
  const checksums = [];
  for (const name of files)
    checksums.push(
      `${createHash("sha256")
        .update(await readFile(path.join(output, name)))
        .digest("hex")}  ${name}`,
    );
  await writeFile(path.join(output, "SHA256SUMS"), checksums.join("\n") + "\n");
  console.log(`Release assets: ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
