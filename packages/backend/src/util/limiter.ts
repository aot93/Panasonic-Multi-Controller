/**
 * Bounds how many async jobs run at once. Used to cap concurrent projector
 * connections — both for the poller (`settings.poll_concurrency`) and for
 * command dispatch to a large group/"all" target — rather than opening a
 * socket per device all at once.
 *
 * Deliberately hand-rolled instead of pulling in a queue/concurrency library:
 * the need is exactly "run these N thunks, at most `concurrency` at a time",
 * which is a dozen lines and not worth a dependency.
 */
export function createLimiter(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (concurrency < 1) {
    throw new Error(`concurrency must be at least 1, got ${concurrency}`);
  }

  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (active >= concurrency) return;
    const run = queue.shift();
    if (!run) return;
    active++;
    run();
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
