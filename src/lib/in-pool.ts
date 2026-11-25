/** `work` over `items`, at most `n` at once, starting the next as soon as one finishes; results in order. */
export async function inPool<T, R>(items: readonly T[], n: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await work(items[k]); }
  }));
  return out;
}
