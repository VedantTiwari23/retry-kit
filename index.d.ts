/**
 * TypeScript declarations for @vedant_/retry-kit
 */

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/** Thrown when all retry attempts have been exhausted. */
export declare class RetryError extends Error {
  readonly name: 'RetryError';
  /** Total number of attempts made (initial + retries). */
  readonly attempts: number;
  /** Every error thrown across all attempts, in order. */
  readonly errors: Error[];
  /** The last error; also set on `Error.cause`. */
  readonly cause: Error;
  constructor(message: string, attempts: number, errors: Error[]);
}

/** Thrown when a per-attempt or the total timeout is exceeded. */
export declare class TimeoutError extends Error {
  readonly name: 'TimeoutError';
  /** Which timeout triggered: 'attempt' or 'total'. */
  readonly kind: 'attempt' | 'total';
  constructor(message: string, kind: 'attempt' | 'total');
}

/** Thrown when the provided AbortSignal fires. */
export declare class AbortError extends Error {
  readonly name: 'AbortError';
  /** The signal that was aborted. */
  readonly signal: AbortSignal;
  constructor(message: string, signal: AbortSignal);
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type JitterMode = 'none' | 'full' | 'equal';

export interface RetryOptions {
  /**
   * Maximum number of retries (not counting the initial attempt).
   * @default 3
   */
  retries?: number;

  /**
   * Base delay in milliseconds before the first retry.
   * @default 200
   */
  delay?: number;

  /**
   * Exponential backoff multiplier applied to `delay` on each retry.
   * @default 2
   */
  factor?: number;

  /**
   * Upper cap on the computed delay, in milliseconds.
   * @default 30000
   */
  maxDelay?: number;

  /**
   * Jitter strategy applied to the computed delay.
   * - `'none'`  → no jitter, deterministic delay.
   * - `'full'`  → random value in [0, delay].
   * - `'equal'` → delay/2 + random value in [0, delay/2].
   * @default 'full'
   */
  jitter?: JitterMode;

  /**
   * Per-attempt timeout in milliseconds. If a single attempt takes longer
   * than this, a `TimeoutError` with `kind === 'attempt'` is thrown and
   * the attempt is counted as a failure eligible for retry.
   */
  timeout?: number;

  /**
   * Overall timeout in milliseconds, spanning all attempts and waits.
   * When exceeded a `TimeoutError` with `kind === 'total'` is thrown.
   */
  totalTimeout?: number;

  /**
   * An `AbortSignal` that cancels the entire retry loop immediately —
   * even during the sleep between retries.
   */
  signal?: AbortSignal;

  /**
   * Called before each retry wait. Return `false` to stop retrying
   * (a `RetryError` is thrown instead).
   *
   * @param error   - The error from the last attempt.
   * @param attempt - The 1-based attempt index that just failed.
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;

  /**
   * Called before sleeping between retries.
   *
   * @param error       - The error from the last attempt.
   * @param attempt     - The 1-based attempt index that just failed.
   * @param nextDelayMs - Milliseconds that will be waited before the next attempt.
   */
  onRetry?: (error: Error, attempt: number, nextDelayMs: number) => void;

  /**
   * Only retry if the error's `.code`, `.status`, or `.statusCode`
   * matches one of the values in this array.
   */
  retryOn?: Array<string | number>;
}

// ---------------------------------------------------------------------------
// retry()
// ---------------------------------------------------------------------------

/**
 * Retries an async function with exponential backoff and optional jitter.
 *
 * @param fn      - Async function that receives the 1-based attempt number.
 * @param options - Retry configuration.
 * @returns       The resolved value from `fn`.
 *
 * @example
 * ```ts
 * import { retry } from '@vedant_/retry-kit';
 *
 * const data = await retry(
 *   (attempt) => fetch(`https://api.example.com/data?attempt=${attempt}`),
 *   { retries: 5, delay: 300, jitter: 'full' }
 * );
 * ```
 */
export declare function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: RetryOptions
): Promise<T>;

export declare namespace retry {
  /**
   * Returns a new function that wraps `fn` with retry behaviour.
   * The returned function has the same signature as `fn`.
   *
   * @param fn      - Async function to wrap.
   * @param options - Retry configuration.
   *
   * @example
   * ```ts
   * import { retry } from '@vedant_/retry-kit';
   *
   * const robustFetch = retry.wrap(fetch, { retries: 3, delay: 500 });
   * const response = await robustFetch('https://api.example.com');
   * ```
   */
  function wrap<F extends (...args: any[]) => Promise<any>>(
    fn: F,
    options?: RetryOptions
  ): F;
}
