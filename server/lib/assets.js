import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, cleanupTemps, DATA_DIR } from './files.js';

export const ASSET_DIR = path.join(DATA_DIR, 'images');
const bad = (message) => Object.assign(new Error(message), { status: 400, expose: true });

// Remote catalogs sometimes label PNG bytes as WebP. Detect only supported
// raster signatures; size/dimension checks still run in saveImage.
export function rasterMime(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function dimensions(buffer, ext) {
  if (ext === 'png' && buffer.length >= 33 && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  }
  if (ext === 'jpg') {
    let i = 2;
    while (i + 8 < buffer.length) {
      if (buffer[i++] !== 0xff) break;
      while (buffer[i] === 0xff) i++;
      const marker = buffer[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      const size = buffer.readUInt16BE(i);
      if (size < 2 || i + size > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return [buffer.readUInt16BE(i + 5), buffer.readUInt16BE(i + 3)];
      i += size;
    }
  }
  if (ext === 'webp' && buffer.length >= 30) {
    const kind = buffer.toString('ascii', 12, 16);
    if (kind === 'VP8X' && !(buffer[20] & 2)) return [buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1];
    if (kind === 'VP8 ' && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
  }
  throw bad('图片尺寸无法识别或为不支持的动画，请重新导出静态图片');
}

export function createAssetStore(directory = ASSET_DIR, { maxFiles = 10_000, maxBytes = 512 * 1024 * 1024 } = {}) {
  let chain = cleanupTemps(directory);
  return {
    async saveImage(buffer, contentType) {
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 4 * 1024 * 1024) throw bad('图片大小须在 4 MB 以内');
      const mime = String(contentType || '').split(';')[0];
      const ext = mime === rasterMime(buffer) ? ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[mime] : null;
      if (!ext) throw bad('图片格式无效，请上传 PNG、JPG 或 WebP');
      const [width, height] = dimensions(buffer, ext);
      if (!width || !height || width > 8192 || height > 8192 || width * height > 16_000_000) throw bad('图片尺寸须不超过 8192 边长和 1600 万像素');
      const filename = `${createHash('sha256').update(buffer).digest('hex')}.${ext}`;
      const operation = chain.then(async () => {
        await mkdir(directory, { recursive: true });
        const files = (await readdir(directory)).filter((name) => /^[a-f0-9]{64}\.(png|jpg|webp)$/.test(name));
        if (files.includes(filename)) return { url: `/media/${filename}` };
        let bytes = 0;
        for (const name of files) bytes += (await stat(path.join(directory, name))).size;
        if (files.length >= maxFiles || bytes + buffer.length > maxBytes) throw Object.assign(bad('图片库容量已满，请先清理不再使用的图片'), { status: 413 });
        await atomicWrite(path.join(directory, filename), buffer);
        return { url: `/media/${filename}` };
      });
      chain = operation.catch(() => {});
      return operation;
    },
    async collectUnused(references, { graceMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
      const operation = chain.then(async () => {
        let removed = 0;
        try {
          for (const filename of await readdir(directory)) {
            if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(filename) || references.has(`/media/${filename}`)) continue;
            const file = path.join(directory, filename);
            if (Date.now() - (await stat(file)).mtimeMs > graceMs) { await rm(file); removed++; }
          }
        } catch (err) { if (err.code !== 'ENOENT') throw err; }
        return removed;
      });
      chain = operation.catch(() => {}); return operation;
    },
  };
}

export const { saveImage } = createAssetStore();
