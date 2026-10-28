import path from 'node:path';
import { stat } from 'node:fs/promises';
import { ASSET_DIR, rasterMime, saveImage } from './assets.js';
import { atomicWrite, DATA_DIR, readJSONFile } from './files.js';
import { fetchRemoteBytes } from './remote-feed.js';
import { inputError } from './limits.js';

const localImage = /^\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/;
export function createRemoteMediaCache({ directory = DATA_DIR, imageDirectory = ASSET_DIR, save = saveImage,
  fetchImage = (url) => fetchRemoteBytes(url, { timeoutMs: 6000, maxBytes: 4 * 1024 * 1024,
    accept: 'image/png,image/jpeg,image/webp',
    allowedOrigins: (process.env.RESOLVER_MEDIA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean) }),
} = {}) {
  const indexFile = path.join(directory, 'remote-media.json');
  const entries = new Map();
  let chain = Promise.resolve();
  const ready = readJSONFile(indexFile, 10 * 1024 * 1024).then((record) => {
    if (!Array.isArray(record)) throw new Error('素材缓存索引损坏');
    for (const [url, cached] of record.slice(-2000)) if (typeof url === 'string' && localImage.test(cached)) entries.set(url, cached);
  }).catch((err) => { if (err.code !== 'ENOENT') throw err; });
  ready.catch(() => {}); // The first cache request reports a corrupt index without overwriting it.
  const inflight = new Map();
  let running = 0;
  const queue = [];
  async function limited(task) {
    if (running >= 4) {
      if (queue.length >= 48) throw inputError('素材准备繁忙，请稍后重试', 503);
      await new Promise((resolve) => queue.push(resolve));
    } else running++;
    try { return await task(); }
    finally { if (queue.length) queue.shift()(); else running--; }
  }
  async function exists(url) {
    try { return (await stat(path.join(imageDirectory, path.basename(url)))).isFile(); }
    catch (err) { if (err.code === 'ENOENT') return false; throw err; }
  }
  async function cache(source) {
    if (localImage.test(source)) {
      if (!await exists(source)) throw inputError('本地图片已丢失，请重新上传');
      return source;
    }
    const cached = entries.get(source);
    if (cached && await exists(cached)) return cached;
    if (!inflight.has(source)) {
      const operation = limited(async () => {
        const { buffer, contentType } = await fetchImage(source);
        const { url } = await save(buffer, rasterMime(buffer) || contentType);
        entries.delete(source); entries.set(source, url);
        while (entries.size > 2000) entries.delete(entries.keys().next().value);
        return url;
      });
      inflight.set(source, operation);
      operation.finally(() => inflight.delete(source)).catch(() => {});
    }
    return inflight.get(source);
  }
  return async (urls) => {
    if (!Array.isArray(urls) || urls.length > 12 || urls.some((url) => typeof url !== 'string' || url.length > 4096 ||
      (!/^https?:\/\//i.test(url) && !localImage.test(url)))) throw inputError('每批最多准备 12 张 http(s) 或本地图片');
    await ready;
    const items = await Promise.all([...new Set(urls)].map(async (source) => {
      try { return { source, url: await cache(source) }; }
      catch (err) { return { source, error: /禁止抓取/.test(err.message)
        ? '图片来源解析到内网或保留地址；代理虚拟 DNS 或局域网素材需配置 RESOLVER_MEDIA_ORIGINS'
        : err.expose ? err.message : '图片下载失败，请检查图片地址或重新上传' }; }
    }));
    const write = chain.then(() => atomicWrite(indexFile, JSON.stringify([...entries])));
    chain = write.catch(() => {});
    await write;
    return { items };
  };
}
export const cacheRemoteMedia = createRemoteMediaCache();
