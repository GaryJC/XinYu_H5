import { requeueTimedOutLegacySyncEvents } from "../repositories/legacySyncRecoveryRepository.mjs";

export function startLegacySyncRecovery({
  recover = requeueTimedOutLegacySyncEvents,
  schedule = setInterval,
  cancel = clearInterval,
  log = console
} = {}) {
  let stopped = false;
  let running;
  const tick = () => {
    if (stopped || running) return;
    running = Promise.resolve().then(recover).then(count => {
      if (count) log.info(`Legacy sync recovery: requeued ${count} timed-out events`);
    }).catch(error => log.error("Legacy sync recovery:", error.message))
      .finally(() => { running = undefined; });
  };
  const timer = schedule(tick, 60_000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    cancel(timer);
    await running;
  };
}
