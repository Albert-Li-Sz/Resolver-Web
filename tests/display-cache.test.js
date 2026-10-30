import test from "node:test";
import assert from "node:assert/strict";
let sequence = 0;
async function cache() {
  return import(`../public/js/display-cache.js?case=${sequence++}`);
}
function storage(t) {
  const records = new Map();
  let abort = false;
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          createObjectStore() {},
          close() {},
          transaction() {
            const transaction = {
              objectStore() {
                return {
                  get(id) {
                    const read = {};
                    queueMicrotask(() => {
                      read.result = structuredClone(records.get(id));
                      read.onsuccess();
                    });
                    return read;
                  },
                  put(value, id) {
                    const snapshot = structuredClone(value);
                    queueMicrotask(() => {
                      if (abort) transaction.onabort();
                      else {
                        records.set(id, snapshot);
                        transaction.oncomplete();
                      }
                    });
                  },
                };
              },
            };
            return transaction;
          },
        };
        request.onupgradeneeded();
        request.onsuccess();
      });
      return request;
    },
  };
  t.after(() => delete globalThis.indexedDB);
  return {
    abort: () => {
      abort = true;
    },
  };
}
test("asynchronous display snapshots survive reload and keep independent screen identities", async (t) => {
  storage(t);
  const first = await cache(),
    snapshot = {
      paired: true,
      name: "Main",
      revision: 8,
      program: { items: [{ type: "clock" }] },
    };
  assert.equal(await first.writeDisplayCache("main", snapshot), true);
  snapshot.program.items[0].type = "logo";
  const reloaded = await cache();
  assert.equal(
    (await reloaded.readDisplayCache("main")).program.items[0].type,
    "clock",
  );
  assert.equal(await reloaded.readDisplayCache("another"), null);
});
test("a failed cache transaction retains the last complete programme", async (t) => {
  const fixture = storage(t),
    c = await cache();
  await c.writeDisplayCache("screen", { revision: 1 });
  fixture.abort();
  assert.equal(await c.writeDisplayCache("screen", { revision: 2 }), false);
  assert.equal((await c.readDisplayCache("screen")).revision, 1);
});
test("disabled IndexedDB reports an unavailable cache without interrupting rendering", async () => {
  const c = await cache();
  assert.equal(await c.readDisplayCache("screen"), null);
  assert.equal(await c.writeDisplayCache("screen", {}), false);
});
