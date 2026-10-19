import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1/unused";
const { startLegacySyncRecovery } = await import("../server/workers/legacySyncRecovery.mjs");
const flush = () => new Promise(resolve => setImmediate(resolve));

test("recovery runs immediately and every minute without overlapping, and stop drains work", async () => {
  let tick, finish, calls = 0, cancelled = false;
  const messages = [];
  const stop = startLegacySyncRecovery({
    recover: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    schedule: (callback, ms) => { tick = callback; assert.equal(ms, 60_000); return { unref() {} }; },
    cancel: () => { cancelled = true; },
    log: { info: message => messages.push(message), error: assert.fail }
  });
  await flush();
  tick(); await flush(); assert.equal(calls, 1);
  finish(2); await flush();
  assert.match(messages[0], /requeued 2/);
  tick(); await flush(); assert.equal(calls, 2);
  let drained = false;
  const stopped = stop().then(() => { drained = true; });
  await flush(); assert.equal(drained, false); assert.equal(cancelled, true);
  finish(0); await stopped;
  tick(); await flush(); assert.equal(calls, 2);
});

test("recovery reports database errors and tries again on the next tick", async () => {
  let tick, calls = 0;
  const errors = [];
  const stop = startLegacySyncRecovery({
    recover: async () => { if (++calls === 1) throw new Error("database unavailable"); return 0; },
    schedule: callback => { tick = callback; return { unref() {} }; },
    cancel() {}, log: { info: assert.fail, error: (...args) => errors.push(args) }
  });
  await flush(); assert.equal(errors[0][1], "database unavailable");
  tick(); await flush(); assert.equal(calls, 2);
  await stop();
});
