/**
 * @fileoverview Core retry logic for @vedant_/retry-kit
 */

import { RetryError, TimeoutError, AbortError } from './errors.js';
import { validateOptions } from './validate.js';

// ---------------------------------------------------------------------------
// JSDoc types
// ---------------------------------------------------------------------------

/**
 * @typedef {'none'|'full'|'equal'} JitterMode
 */

/**
 * @typedef {Object} RetryOptions
 * @property {number}       [retries=3]        - Maximum number of retries (not including the initial attempt).
 * @property {number}       [delay=200]        - Base delay in ms before the first retry.
 * @property {number}       [factor=2]         - Exponential backoff multiplier.
 * @property {number}       [maxDelay=30000]   - Upper cap on computed delay (ms).
 * @property {JitterMode}   [jitter='full']    - Jitter strategy: 'none' | 'full' | 'equal'.
 * @property {number}       [timeout]          - Per-attempt timeout (ms). Throws TimeoutError if exceeded.
 * @property {number}       [totalTimeout]     - Overall timeout (ms) across all attempts + waits.
 * @property {AbortSignal}  [signal]           - AbortSignal to cancel the entire operation immediately.
 * @property {function(Error,number):boolean} [shouldRetry] - Return false to stop retrying.
 * @property {function(Error,number,number):void} [onRetry] - Called before each wait: (error, attempt, nextDelayMs).
 * @property {Array<string|number>} [retryOn]  - Only retry if error.code or error.status matches one of these.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes the next backoff delay (before jitter) for a given attempt.
 *
 * @param {number} baseDelay
 * @param {number} factor
 * @param {number} attempt     - 1-based retry attempt index.
 * @param {number} maxDelay
 * @returns {number}
 */
function computeBaseDelay(baseDelay, factor, attempt, maxDelay) {
  return Math.min(baseDelay * Math.pow(factor, attempt - 1), maxDelay);
}

/**
 * Applies jitter to a base delay value.
 *
 * - `none`  → returns delay unchanged.
 * - `full`  → returns a random value in [0, delay].
 * - `equal` → returns delay/2 + random value in [0, delay/2].
 *
 * @param {number}     delay
 * @param {JitterMode} mode
 * @returns {number}
 */
function applyJitter(delay, mode) {
  switch (mode) {
    case 'full':
      return Math.random() * delay;
    case 'equal':
      return delay / 2 + Math.random() * (delay / 2);
    default:
      return delay;
  }
}

/**
 * Extracts the Retry-After value (in ms) from an error's `.response` if present.
 * Supports both delta-seconds and HTTP-date formats.
 *
 * @param {unknown} err
 * @returns {number|undefined}
 */
function retryAfterMs(err) {
  if (!err || typeof err !== 'object') return undefined;
  const response = /** @type {Record<string,unknown>} */ (err).response;
  if (!response || typeof response !== 'object') return undefined;

  const headers = /** @type {Record<string,unknown>} */ (response).headers;
  if (!headers) return undefined;

  let value;
  if (typeof headers === 'object' && typeof headers.get === 'function') {
    // Fetch-style Headers
    value = /** @type {any} */ (headers).get('retry-after');
  } else if (typeof headers === 'object') {
    // Plain object (e.g., axios)
    const h = /** @type {Record<string,unknown>} */ (headers);
    value = h['retry-after'] ?? h['Retry-After'];
  }

  if (value === undefined || value === null) return undefined;

  const numeric = Number(value);
  if (!isNaN(numeric) && isFinite(numeric)) {
    return numeric * 1000; // delta-seconds → ms
  }

  // HTTP-date
  const date = new Date(String(value)).getTime();
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}

/**
 * Returns a promise that resolves after `ms` milliseconds, but rejects
 * immediately if the AbortSignal fires.  Cleans up listeners on completion.
 *
 * @param {number}            ms
 * @param {AbortSignal|undefined} signal
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new AbortError('Operation aborted', signal));
    }

    let timer;
    let onAbort;

    const cleanup = () => {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    };

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    if (signal) {
      onAbort = () => {
        cleanup();
        reject(new AbortError('Operation aborted', signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Wraps a promise with a per-attempt timeout.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number}     ms
 * @returns {Promise<T>}
 */
function withAttemptTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new TimeoutError(
          `Attempt timed out after ${ms}ms`,
          'attempt'
        )
      );
    }, ms);

    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Checks whether an error matches the `retryOn` filter list.
 *
 * @param {unknown}              err
 * @param {Array<string|number>} retryOn
 * @returns {boolean}
 */
function matchesRetryOn(err, retryOn) {
  if (!retryOn || retryOn.length === 0) return true;
  if (!err || typeof err !== 'object') return false;
  const e = /** @type {Record<string,unknown>} */ (err);
  for (const code of retryOn) {
    if (e.code === code || e.status === code || e.statusCode === code) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core retry function
// ---------------------------------------------------------------------------

/**
 * Retries an async function with exponential backoff and optional jitter.
 *
 * @template T
 * @param {(attempt: number) => Promise<T>} fn       - Async function to execute.
 * @param {RetryOptions}                    [options] - Configuration options.
 * @returns {Promise<T>}
 *
 * @example
 * const data = await retry(() => fetch('https://api.example.com/data'), {
 *   retries: 5,
 *   delay: 300,
 *   jitter: 'full',
 *   onRetry: (err, attempt, delay) => console.log(`Retry #${attempt} in ${delay}ms`),
 * });
 */
export function retry(fn, options) {
  // Validate synchronously so TypeError is thrown before we return a Promise.
  if (typeof fn !== 'function') {
    throw new TypeError('[retry-kit] fn must be a function');
  }
  const opts = validateOptions(options);
  return _retryAsync(fn, opts);
}

/**
 * Internal async implementation (called after synchronous validation).
 *
 * @template T
 * @param {(attempt: number) => Promise<T>}        fn
 * @param {Required<RetryOptions>}                 opts
 * @returns {Promise<T>}
 */
async function _retryAsync(fn, opts) {
  const {
    retries,
    delay,
    factor,
    maxDelay,
    jitter,
    timeout: attemptTimeout,
    totalTimeout,
    signal,
    shouldRetry,
    onRetry,
    retryOn,
  } = opts;

  // ---- Total timeout -------------------------------------------------------
  let totalDeadline = totalTimeout ? Date.now() + totalTimeout : Infinity;

  /** @type {Error[]} */
  const errors = [];
  let attempt = 0; // 1-based during each call

  // ---- Abort pre-check -----------------------------------------------------
  if (signal?.aborted) {
    throw new AbortError('Operation aborted before first attempt', signal);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;

    // -- Total timeout check before each attempt ----------------------------
    if (Date.now() >= totalDeadline) {
      throw new TimeoutError(
        `Total timeout of ${totalTimeout}ms exceeded`,
        'total'
      );
    }

    // -- Run fn (with optional per-attempt timeout) -------------------------
    let result;
    try {
      let callPromise = Promise.resolve().then(() => fn(attempt));

      if (attemptTimeout) {
        callPromise = withAttemptTimeout(callPromise, attemptTimeout);
      }

      result = await callPromise;
      return result; // success
    } catch (err) {
      const error = /** @type {Error} */ (err);
      errors.push(error);

      // -- Abort errors propagate immediately --------------------------------
      if (error instanceof AbortError) throw error;

      // -- Total timeout during an attempt -----------------------------------
      if (error instanceof TimeoutError && error.kind === 'total') throw error;

      // -- Exhausted retries? ------------------------------------------------
      if (attempt > retries) {
        throw new RetryError(
          `All ${attempt} attempt(s) failed`,
          attempt,
          errors
        );
      }

      // -- retryOn filter ----------------------------------------------------
      if (!matchesRetryOn(error, retryOn)) {
        throw new RetryError(
          `Attempt failed with an error that is not in retryOn list (attempt ${attempt})`,
          attempt,
          errors
        );
      }

      // -- shouldRetry callback ----------------------------------------------
      if (shouldRetry && !shouldRetry(error, attempt)) {
        throw new RetryError(
          `shouldRetry returned false on attempt ${attempt}`,
          attempt,
          errors
        );
      }

      // -- Signal check before waiting ---------------------------------------
      if (signal?.aborted) {
        throw new AbortError('Operation aborted', signal);
      }

      // -- Compute delay (honour Retry-After header) -------------------------
      const retryAfterOverride = retryAfterMs(error);
      let waitMs;
      if (retryAfterOverride !== undefined) {
        waitMs = retryAfterOverride;
      } else {
        const base = computeBaseDelay(delay, factor, attempt, maxDelay);
        waitMs = applyJitter(base, jitter);
      }

      // -- Clamp to remaining total timeout ----------------------------------
      const remaining = totalDeadline - Date.now();
      if (remaining <= 0) {
        throw new TimeoutError(
          `Total timeout of ${totalTimeout}ms exceeded`,
          'total'
        );
      }
      waitMs = Math.min(waitMs, remaining);

      // -- onRetry callback --------------------------------------------------
      if (onRetry) {
        try {
          onRetry(error, attempt, waitMs);
        } catch {
          // ignore errors from user callbacks
        }
      }

      // -- Sleep (abortable) -------------------------------------------------
      await sleep(waitMs, signal);
    }
  }
}

// ---------------------------------------------------------------------------
// retry.wrap
// ---------------------------------------------------------------------------

/**
 * Returns a new function that wraps `fn` with retry behaviour.
 *
 * @template {(...args: any[]) => Promise<any>} F
 * @param {F}            fn       - Async function to wrap.
 * @param {RetryOptions} [options] - Retry configuration.
 * @returns {F} Wrapped function with identical signature.
 *
 * @example
 * const robustFetch = retry.wrap(fetch, { retries: 3, delay: 500 });
 * const response = await robustFetch('https://api.example.com');
 */
retry.wrap = function wrap(fn, options) {
  if (typeof fn !== 'function') {
    throw new TypeError('[retry-kit] retry.wrap: fn must be a function');
  }
  return function (...args) {
    return retry(() => fn(...args), options);
  };
};
