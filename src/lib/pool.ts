/**
 * Bounded worker-pool for running many async jobs with limited concurrency.
 * Used for both Gmail metadata fetches and JEV requests.
 */

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onSettled?: (result: R, index: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const result = await fn(items[index], index);
      results[index] = result;
      onSettled?.(result, index);
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);

  return results;
}
