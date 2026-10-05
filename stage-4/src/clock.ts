let latestTick = 0;

/** The service's notion of now: never behind any instant the service has already issued. */
export function now(): number {
  return Math.max(Date.now(), latestTick);
}

/** A fresh instant, strictly later than every instant issued before it. */
export function tick(): number {
  latestTick = Math.max(Date.now(), latestTick + 1);
  return latestTick;
}

/** Makes sure later ticks are not earlier than an instant that came from outside. */
export function observe(epochMs: number): void {
  if (epochMs > latestTick && epochMs <= Date.now()) latestTick = epochMs;
}
