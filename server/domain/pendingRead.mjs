// Share only overlapping reads. Settled values (including failures) are never cached.
// Commands must call their fresh reader directly, outside this coordinator.
export function createPendingRead() {
  const pending = new Map();
  return function read(key, load) {
    if (pending.has(key)) return pending.get(key);
    const result = Promise.resolve().then(load).finally(() => {
      if (pending.get(key) === result) pending.delete(key);
    });
    pending.set(key, result);
    return result;
  };
}
