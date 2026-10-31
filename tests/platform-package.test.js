import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
test("deployment package includes both pinned images, gateway configuration, guides and valid checksums", async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), "platform-package-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const version = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url)),
  ).version;
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const image = "ghcr.io/example/platform-qualification-fixture";
  await writeFile(
    path.join(temp, "app.json"),
    JSON.stringify({ version, revision, image }),
  );
  await writeFile(
    path.join(temp, "media.json"),
    JSON.stringify({ version, revision, image: image + "-media-worker" }),
  );
  const out = path.join(temp, "output");
  execFileSync(process.execPath, [
    "scripts/package-release.mjs",
    out,
    path.join(temp, "app.json"),
    path.join(temp, "media.json"),
  ]);
  const unpack = path.join(temp, "unpack");
  await mkdir(unpack);
  execFileSync("tar", [
    "-xzf",
    path.join(out, `resolver-web-v${version}-deploy.tar.gz`),
    "-C",
    unpack,
  ]);
  const compose = await readFile(path.join(unpack, "compose.yaml"), "utf8");
  assert.match(compose, /mediamtx:/);
  assert.match(compose, /media-worker:/);
  assert.doesNotMatch(compose, /^\s+build:/m);
  assert.doesNotMatch(compose, /platform-local/);
  assert.ok(compose.includes(image + ":v" + version));
  assert.ok(compose.includes(image + "-media-worker:v" + version));
  const env = await readFile(path.join(unpack, ".env.example"), "utf8");
  assert.match(env, new RegExp("RESOLVER_IMAGE=" + image + ":v" + version));
  assert.match(env, /MEDIA_WORKER_IMAGE=/);
  assert.equal(env.match(/^RESOLVER_IMAGE=/gm)?.length, 1);
  assert.equal(env.match(/^MEDIA_WORKER_IMAGE=/gm)?.length, 1);
  assert.doesNotMatch(env, /:main\b/);
  assert.match(
    await readFile(path.join(unpack, "deploy/mediamtx.yml"), "utf8"),
    /authHTTPAddress:/,
  );
  assert.match(
    await readFile(path.join(unpack, "GUIDE.md"), "utf8"),
    /PresentationAdmin/,
  );
  assert.match(
    await readFile(path.join(unpack, "PLATFORM-VALIDATION.md"), "utf8"),
    /本地验收记录/,
  );
  assert.ok(
    (await readFile(path.join(unpack, "images/platform/home.jpg"))).length >
      1000,
  );
  for (const file of [
    "INSTALL.md",
    "NETWORK.md",
    "OLLAMA-VALIDATION.md",
    "ollama-pixel-comparison.json",
    "ollama-performance.json",
    "images/ollama/home-browser.jpg",
  ])
    assert.deepEqual(
      await readFile(path.join(unpack, file)),
      await readFile(new URL(`../doc/${file}`, import.meta.url)),
      file,
    );
  for (const line of (await readFile(path.join(out, "SHA256SUMS"), "utf8"))
    .trim()
    .split("\n")) {
    const [expected, file] = line.split("  ");
    assert.equal(
      createHash("sha256")
        .update(await readFile(path.join(out, file)))
        .digest("hex"),
      expected,
    );
  }
});
