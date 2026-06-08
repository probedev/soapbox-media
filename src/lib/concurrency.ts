/**
 * Bounded-concurrency worker pool. Runs `fn` over `items` with at most
 * `concurrency` in flight at once, pulling from a shared cursor (no
 * head-of-line blocking). `fn` returns void and does its own work / side
 * effects / counter mutation - safe to mutate shared counters because JS is
 * single-threaded (the `+=` after each await never interleaves).
 *
 * If `stopAt` (epoch ms) is given, workers stop pulling NEW items once the
 * deadline passes; in-flight items still finish. Returns how many items were
 * actually processed (so callers can detect a deadline cutoff).
 */
export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  stopAt?: number,
): Promise<{ completed: number }> {
  let next = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      if (stopAt && Date.now() > stopAt) return;
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i);
      completed++;
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { completed };
}
