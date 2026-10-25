import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ASSET_DIR, createAssetStore } from '../server/lib/assets.js';
import { getConfig, listConfigs } from '../server/lib/store.js';
import { mediaLibrary } from '../server/lib/media-library.js';
import { readJSONFile } from '../server/lib/files.js';

// Dry run by default. Stop the service and export unsaved browser state before
// passing --delete. Extra JSON paths may contain those exported references.
const references = new Set();
function collect(value) {
  if (typeof value === 'string' && /^\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value)) references.add(value);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item);
}
for (const record of await listConfigs()) collect(await getConfig(record.id));
collect(await mediaLibrary.list());
for (const file of process.argv.slice(2).filter((arg) => !arg.startsWith('--'))) collect(await readJSONFile(path.resolve(file)));
const graceMs = 7 * 24 * 60 * 60 * 1000;
let files = [];
try { files = await readdir(ASSET_DIR); } catch (err) { if (err.code !== 'ENOENT') throw err; }
const candidates = [];
for (const file of files) if (/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(file) && !references.has(`/media/${file}`) &&
  Date.now() - (await stat(path.join(ASSET_DIR, file))).mtimeMs > graceMs) candidates.push(file);
console.log(JSON.stringify({ mode: process.argv.includes('--delete') ? 'delete' : 'dry-run', candidates }, null, 2));
if (process.argv.includes('--delete')) console.log(`Removed ${await createAssetStore().collectUnused(references, { graceMs })} unreferenced images`);
