export type AsyncMapper<TInput, TOutput> = (item: TInput, index: number) => Promise<TOutput>;

/**
 * Splits an array into fixed-size batches.
 */
export function chunkIntoBatches<T>(items: readonly T[], batchSize: number): T[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }

  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Maps items with an async mapper while enforcing a max concurrency.
 */
export async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  mapper: AsyncMapper<TInput, TOutput>,
  concurrency: number
): Promise<TOutput[]> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("concurrency must be a positive integer");
  }

  if (items.length === 0) {
    return [];
  }

  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;

      const item = items[index];
      if (item === undefined) {
        continue;
      }

      results[index] = await mapper(item, index);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

/**
 * Runs batch operations in sequence while each batch executes in parallel.
 */
export async function mapInBatches<TInput, TOutput>(
  items: readonly TInput[],
  mapper: AsyncMapper<TInput, TOutput>,
  batchSize: number
): Promise<TOutput[]> {
  const batches = chunkIntoBatches(items, batchSize);
  const output: TOutput[] = [];

  let offset = 0;
  for (const batch of batches) {
    const mapped = await Promise.all(batch.map((item, index) => mapper(item, offset + index)));
    output.push(...mapped);
    offset += batch.length;
  }

  return output;
}
