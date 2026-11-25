/**
 * Adaptive eth_getLogs block-range scanner for public RPCs.
 * - starts at `initialRange`, halves on any error (range/limit/timeouts) down to `minRange`,
 *   grows ×2 after `growAfter` consecutive successes up to `maxRange`;
 * - exponential backoff between failed attempts; gives up (throws) after `maxRetries` consecutive failures.
 */
export interface ScanOptions {
  initialRange: number;
  maxRange: number;
  minRange: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  growAfter: number;
  sleep?: (ms: number) => Promise<void>;
  onError?: (err: unknown, from: bigint, to: bigint, attempt: number) => void;
}

export const DEFAULT_SCAN: ScanOptions = { initialRange: 2000, maxRange: 5000, minRange: 25, maxRetries: 8, baseDelayMs: 500, maxDelayMs: 30_000, growAfter: 3 };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class AdaptiveRange {
  size: number;
  private ok = 0;
  failures = 0;
  private min: number;
  constructor(private o: ScanOptions) {
    this.min = Math.max(1, Math.min(o.minRange, o.maxRange));
    this.size = Math.max(this.min, Math.min(o.initialRange, o.maxRange));
  }
  end(from: bigint, latest: bigint): bigint {
    const to = from + BigInt(this.size) - 1n;
    return to < latest ? to : latest;
  }
  success() {
    this.failures = 0;
    if (++this.ok >= this.o.growAfter) {
      this.ok = 0;
      this.size = Math.min(this.o.maxRange, this.size * 2);
    }
  }
  /** Returns the backoff delay to wait before the next attempt. */
  failure(): number {
    this.ok = 0;
    this.failures++;
    this.size = Math.max(this.min, Math.floor(this.size / 2));
    return Math.min(this.o.maxDelayMs, this.o.baseDelayMs * 2 ** (this.failures - 1));
  }
}

/**
 * Walks [from, to] in adaptive chunks. `onChunk` returns true to stop early (e.g. discovery matched).
 * Returns the last block fully processed (from - 1 if nothing was processed) and whether it stopped early.
 */
export async function scanRange<T>(
  from: bigint,
  to: bigint,
  fetch: (from: bigint, to: bigint) => Promise<T>,
  onChunk: (result: T, from: bigint, to: bigint) => Promise<boolean | void>,
  range: AdaptiveRange,
  o: ScanOptions,
): Promise<{ last: bigint; stopped: boolean }> {
  const sleep = o.sleep ?? realSleep;
  let cur = from;
  while (cur <= to) {
    const end = range.end(cur, to);
    let res: T;
    try {
      res = await fetch(cur, end);
    } catch (err) {
      const delay = range.failure();
      o.onError?.(err, cur, end, range.failures);
      if (range.failures > o.maxRetries) throw err;
      await sleep(delay);
      continue;
    }
    range.success();
    const stop = await onChunk(res, cur, end);
    if (stop) return { last: end, stopped: true };
    cur = end + 1n;
  }
  return { last: to, stopped: false };
}

/** Runs `fn` over items with at most `n` in flight; preserves order. */
export async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
