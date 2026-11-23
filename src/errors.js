/**
 * @fileoverview Custom error classes for @vedant_/retry-kit
 */

// ---------------------------------------------------------------------------
// RetryError
// ---------------------------------------------------------------------------

/**
 * Thrown when all retry attempts have been exhausted.
 *
 * @property {number}  attempts - Total number of attempts made.
 * @property {Error[]} errors   - Every error thrown across all attempts.
 * @property {Error}   cause    - The last error (also set on `Error.cause`).
 */
export class RetryError extends Error {
  /**
   * @param {string}  message
   * @param {number}  attempts
   * @param {Error[]} errors
   */
  constructor(message, attempts, errors) {
    const cause = errors[errors.length - 1];
    super(message, { cause });
    this.name = 'RetryError';
    this.attempts = attempts;
    this.errors = errors;
    this.cause = cause;
    if (Error.captureStackTrace) Error.captureStackTrace(this, RetryError);
  }
}

// ---------------------------------------------------------------------------
// TimeoutError
// ---------------------------------------------------------------------------

/**
 * Thrown when a per-attempt or total timeout is exceeded.
 *
 * @property {'attempt'|'total'} kind - Which timeout triggered.
 */
export class TimeoutError extends Error {
  /**
   * @param {string}             message
   * @param {'attempt'|'total'}  kind
   */
  constructor(message, kind) {
    super(message);
    this.name = 'TimeoutError';
    this.kind = kind;
    if (Error.captureStackTrace) Error.captureStackTrace(this, TimeoutError);
  }
}

// ---------------------------------------------------------------------------
// AbortError
// ---------------------------------------------------------------------------

/**
 * Thrown when an AbortSignal is triggered before all retries finish.
 *
 * @property {AbortSignal} signal - The signal that was aborted.
 */
export class AbortError extends Error {
  /**
   * @param {string}      message
   * @param {AbortSignal} signal
   */
  constructor(message, signal) {
    super(message);
    this.name = 'AbortError';
    this.signal = signal;
    if (Error.captureStackTrace) Error.captureStackTrace(this, AbortError);
  }
}
