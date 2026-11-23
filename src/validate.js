/**
 * @fileoverview Option validation helpers for @vedant_/retry-kit
 */

/** @type {Set<string>} */
const VALID_JITTER = new Set(['none', 'full', 'equal']);

/**
 * Validates and normalises the options object passed to `retry()`.
 *
 * @param {unknown} opts - Raw options value.
 * @returns {Required<import('./retry.js').RetryOptions>} Normalised options.
 * @throws {TypeError} On invalid option value.
 */
export function validateOptions(opts) {
  if (opts === undefined || opts === null) opts = {};
  if (typeof opts !== 'object' || Array.isArray(opts)) {
    throw new TypeError(
      '[retry-kit] options must be a plain object, got: ' + typeof opts
    );
  }

  const o = /** @type {Record<string,unknown>} */ (opts);

  // ---- retries -------------------------------------------------------------
  const retries = o.retries !== undefined ? o.retries : 3;
  if (
    typeof retries !== 'number' ||
    !Number.isInteger(retries) ||
    retries < 0
  ) {
    throw new TypeError(
      '[retry-kit] options.retries must be a non-negative integer, got: ' +
        JSON.stringify(retries)
    );
  }

  // ---- delay ---------------------------------------------------------------
  const delay = o.delay !== undefined ? o.delay : 200;
  if (typeof delay !== 'number' || delay < 0 || !isFinite(delay)) {
    throw new TypeError(
      '[retry-kit] options.delay must be a non-negative finite number (ms), got: ' +
        JSON.stringify(delay)
    );
  }

  // ---- factor --------------------------------------------------------------
  const factor = o.factor !== undefined ? o.factor : 2;
  if (typeof factor !== 'number' || factor < 1 || !isFinite(factor)) {
    throw new TypeError(
      '[retry-kit] options.factor must be a finite number >= 1, got: ' +
        JSON.stringify(factor)
    );
  }

  // ---- maxDelay ------------------------------------------------------------
  const maxDelay = o.maxDelay !== undefined ? o.maxDelay : 30000;
  if (typeof maxDelay !== 'number' || maxDelay < 0 || !isFinite(maxDelay)) {
    throw new TypeError(
      '[retry-kit] options.maxDelay must be a non-negative finite number (ms), got: ' +
        JSON.stringify(maxDelay)
    );
  }

  // ---- jitter --------------------------------------------------------------
  const jitter = o.jitter !== undefined ? o.jitter : 'full';
  if (!VALID_JITTER.has(/** @type {string} */ (jitter))) {
    throw new TypeError(
      '[retry-kit] options.jitter must be "none", "full", or "equal", got: ' +
        JSON.stringify(jitter)
    );
  }

  // ---- timeout -------------------------------------------------------------
  const timeout = o.timeout !== undefined ? o.timeout : undefined;
  if (
    timeout !== undefined &&
    (typeof timeout !== 'number' || timeout <= 0 || !isFinite(timeout))
  ) {
    throw new TypeError(
      '[retry-kit] options.timeout must be a positive finite number (ms), got: ' +
        JSON.stringify(timeout)
    );
  }

  // ---- totalTimeout --------------------------------------------------------
  const totalTimeout =
    o.totalTimeout !== undefined ? o.totalTimeout : undefined;
  if (
    totalTimeout !== undefined &&
    (typeof totalTimeout !== 'number' ||
      totalTimeout <= 0 ||
      !isFinite(totalTimeout))
  ) {
    throw new TypeError(
      '[retry-kit] options.totalTimeout must be a positive finite number (ms), got: ' +
        JSON.stringify(totalTimeout)
    );
  }

  // ---- signal --------------------------------------------------------------
  const signal = o.signal !== undefined ? o.signal : undefined;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError(
      '[retry-kit] options.signal must be an AbortSignal instance'
    );
  }

  // ---- shouldRetry ---------------------------------------------------------
  const shouldRetry =
    o.shouldRetry !== undefined ? o.shouldRetry : undefined;
  if (shouldRetry !== undefined && typeof shouldRetry !== 'function') {
    throw new TypeError(
      '[retry-kit] options.shouldRetry must be a function'
    );
  }

  // ---- onRetry -------------------------------------------------------------
  const onRetry = o.onRetry !== undefined ? o.onRetry : undefined;
  if (onRetry !== undefined && typeof onRetry !== 'function') {
    throw new TypeError('[retry-kit] options.onRetry must be a function');
  }

  // ---- retryOn -------------------------------------------------------------
  const retryOn = o.retryOn !== undefined ? o.retryOn : undefined;
  if (retryOn !== undefined) {
    if (!Array.isArray(retryOn)) {
      throw new TypeError(
        '[retry-kit] options.retryOn must be an array of error codes / status codes'
      );
    }
    for (const item of retryOn) {
      if (typeof item !== 'string' && typeof item !== 'number') {
        throw new TypeError(
          '[retry-kit] options.retryOn items must be strings or numbers, got: ' +
            JSON.stringify(item)
        );
      }
    }
  }

  return {
    retries: /** @type {number} */ (retries),
    delay: /** @type {number} */ (delay),
    factor: /** @type {number} */ (factor),
    maxDelay: /** @type {number} */ (maxDelay),
    jitter: /** @type {'none'|'full'|'equal'} */ (jitter),
    timeout,
    totalTimeout,
    signal,
    shouldRetry,
    onRetry,
    retryOn,
  };
}
