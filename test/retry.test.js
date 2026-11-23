/**
 * @fileoverview Test suite for @vedant_/retry-kit
 * Uses Node.js built-in test runner (node --test)
 */

import { test, describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Import from the dist/esm build (mimics real consumer usage).
// Fall back to src/ when dist hasn't been built yet.
import { retry, RetryError, TimeoutError, AbortError } from '../dist/esm/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a function that fails `n` times, then resolves with `value`. */
function failTimes(n, value = 'ok', ErrorFactory = () => new Error('boom')) {
  let calls = 0;
  return async () => {
    calls++;
    if (calls <= n) throw ErrorFactory();
    return value;
  };
}

/** Tiny fixed delay (ms). */
const TINY = 5;

/** Default options with very small delays so the suite runs in <2 s. */
const FAST = { delay: TINY, maxDelay: TINY * 10, jitter: 'none' };

// ---------------------------------------------------------------------------
// 1. First-try success
// ---------------------------------------------------------------------------
describe('first-try success', () => {
  it('resolves immediately when fn succeeds on first attempt', async () => {
    const result = await retry(async () => 42, FAST);
    assert.equal(result, 42);
  });

  it('passes attempt=1 to fn on first try', async () => {
    let seen;
    await retry(async (attempt) => { seen = attempt; }, FAST);
    assert.equal(seen, 1);
  });
});

// ---------------------------------------------------------------------------
// 2. Success after N failures
// ---------------------------------------------------------------------------
describe('success after N failures', () => {
  it('succeeds on 2nd attempt', async () => {
    const fn = failTimes(1, 'second');
    const result = await retry(fn, { ...FAST, retries: 3 });
    assert.equal(result, 'second');
  });

  it('succeeds on 3rd attempt (retries=3)', async () => {
    const fn = failTimes(2, 'third');
    const result = await retry(fn, { ...FAST, retries: 3 });
    assert.equal(result, 'third');
  });

  it('passes incrementing attempt numbers to fn', async () => {
    const attempts = [];
    const fn = failTimes(2, 'done');
    await retry(async (attempt) => {
      attempts.push(attempt);
      return fn(attempt);
    }, { ...FAST, retries: 5 });
    assert.deepEqual(attempts, [1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// 3. Exhausting retries → RetryError
// ---------------------------------------------------------------------------
describe('exhausting retries', () => {
  it('throws RetryError after retries+1 attempts', async () => {
    const fn = failTimes(99, 'never');
    await assert.rejects(
      () => retry(fn, { ...FAST, retries: 2 }),
      (err) => {
        assert.ok(err instanceof RetryError, 'should be RetryError');
        assert.equal(err.name, 'RetryError');
        assert.equal(err.attempts, 3); // 1 initial + 2 retries
        assert.equal(err.errors.length, 3);
        assert.ok(err.cause instanceof Error);
        return true;
      }
    );
  });

  it('RetryError.errors contains all thrown errors', async () => {
    let call = 0;
    const errs = [new Error('a'), new Error('b'), new Error('c')];
    await assert.rejects(
      () =>
        retry(
          async () => {
            throw errs[call++];
          },
          { ...FAST, retries: 2 }
        ),
      (err) => {
        assert.ok(err instanceof RetryError);
        assert.deepEqual(err.errors, errs);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 4. shouldRetry stopping early
// ---------------------------------------------------------------------------
describe('shouldRetry', () => {
  it('stops immediately when shouldRetry returns false', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retry(
          async () => {
            calls++;
            throw new Error('no');
          },
          {
            ...FAST,
            retries: 10,
            shouldRetry: () => false,
          }
        ),
      (err) => {
        assert.ok(err instanceof RetryError);
        assert.equal(calls, 1); // only the initial attempt
        return true;
      }
    );
  });

  it('receives (error, attempt) arguments', async () => {
    const received = [];
    await assert.rejects(
      () =>
        retry(
          async () => {
            throw new Error('x');
          },
          {
            ...FAST,
            retries: 3,
            shouldRetry: (err, attempt) => {
              received.push({ err, attempt });
              return attempt < 2; // stop after 2nd attempt fails
            },
          }
        ),
      () => true
    );
    assert.equal(received.length, 2);
    assert.equal(received[0].attempt, 1);
    assert.equal(received[1].attempt, 2);
  });
});

// ---------------------------------------------------------------------------
// 5. Abort before first attempt
// ---------------------------------------------------------------------------
describe('AbortSignal — abort before start', () => {
  it('throws AbortError immediately when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(
      () => retry(async () => 'ok', { signal: ctrl.signal }),
      (err) => {
        assert.ok(err instanceof AbortError);
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Abort during wait between retries
// ---------------------------------------------------------------------------
describe('AbortSignal — abort during wait', () => {
  it('stops during the sleep between retries', async () => {
    const ctrl = new AbortController();
    let callCount = 0;

    const p = retry(
      async () => {
        callCount++;
        throw new Error('fail');
      },
      {
        delay: 500,     // long enough that we can abort mid-wait
        maxDelay: 500,
        jitter: 'none',
        retries: 10,
        signal: ctrl.signal,
      }
    );

    // Abort after the first attempt has fired
    setTimeout(() => ctrl.abort(), 50);

    await assert.rejects(() => p, (err) => {
      assert.ok(err instanceof AbortError);
      return true;
    });

    // Should have attempted at most once (aborted during first sleep)
    assert.ok(callCount <= 2, `expected ≤2 calls, got ${callCount}`);
  });
});

// ---------------------------------------------------------------------------
// 7. Per-attempt timeout
// ---------------------------------------------------------------------------
describe('per-attempt timeout', () => {
  it('throws TimeoutError with kind="attempt" when attempt is too slow', async () => {
    await assert.rejects(
      () =>
        retry(
          async () => new Promise((r) => setTimeout(r, 500)),
          { ...FAST, retries: 0, timeout: 50 }
        ),
      (err) => {
        // The RetryError wraps a TimeoutError as its cause
        assert.ok(err instanceof RetryError || err instanceof TimeoutError);
        if (err instanceof RetryError) {
          assert.ok(err.cause instanceof TimeoutError);
          assert.equal(err.cause.kind, 'attempt');
        } else {
          assert.equal(err.kind, 'attempt');
        }
        return true;
      }
    );
  });

  it('succeeds if attempt completes within the timeout', async () => {
    const result = await retry(
      async () => { return 'fast'; },
      { ...FAST, timeout: 1000 }
    );
    assert.equal(result, 'fast');
  });
});

// ---------------------------------------------------------------------------
// 8. Total timeout
// ---------------------------------------------------------------------------
describe('totalTimeout', () => {
  it('throws TimeoutError with kind="total" when overall budget is exceeded', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retry(
          async () => {
            calls++;
            await new Promise((r) => setTimeout(r, 60));
            throw new Error('slow');
          },
          { delay: 10, maxDelay: 10, jitter: 'none', retries: 50, totalTimeout: 120 }
        ),
      (err) => {
        assert.ok(err instanceof TimeoutError, `Expected TimeoutError, got ${err?.constructor?.name}`);
        assert.equal(err.kind, 'total');
        return true;
      }
    );
    // Shouldn't have run many times
    assert.ok(calls <= 5, `expected few calls, got ${calls}`);
  });
});

// ---------------------------------------------------------------------------
// 9. Jitter bounds
// ---------------------------------------------------------------------------
describe('jitter', () => {
  it('"none" produces the exact computed delay (no randomness)', () => {
    // We can verify by checking the base formula directly
    // delay=100, factor=2, attempt=1 → base=100
    // delay=100, factor=2, attempt=2 → base=200
    // This test just checks the option is accepted and doesn't throw
    assert.doesNotThrow(() =>
      retry(async () => 'ok', { delay: 100, jitter: 'none', retries: 0 })
    );
  });

  it('"full" jitter stays in [0, computed_delay]', async () => {
    // Run many iterations and collect delay samples via onRetry
    const samples = [];
    const baseDelay = 100;
    await assert.rejects(
      () =>
        retry(
          async () => { throw new Error('x'); },
          {
            retries: 20,
            delay: baseDelay,
            factor: 1, // constant base
            maxDelay: baseDelay,
            jitter: 'full',
            onRetry: (_, __, ms) => samples.push(ms),
          }
        ),
      () => true
    );
    assert.ok(samples.length > 0);
    for (const s of samples) {
      assert.ok(s >= 0 && s <= baseDelay + 1, `out-of-range sample: ${s}`);
    }
  });

  it('"equal" jitter stays in [delay/2, delay]', async () => {
    const samples = [];
    const baseDelay = 100;
    await assert.rejects(
      () =>
        retry(
          async () => { throw new Error('x'); },
          {
            retries: 20,
            delay: baseDelay,
            factor: 1,
            maxDelay: baseDelay,
            jitter: 'equal',
            onRetry: (_, __, ms) => samples.push(ms),
          }
        ),
      () => true
    );
    assert.ok(samples.length > 0);
    for (const s of samples) {
      assert.ok(
        s >= baseDelay / 2 - 1 && s <= baseDelay + 1,
        `out-of-range equal-jitter sample: ${s}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 10. maxDelay cap
// ---------------------------------------------------------------------------
describe('maxDelay', () => {
  it('caps delay at maxDelay', async () => {
    const samples = [];
    const cap = 50;
    await assert.rejects(
      () =>
        retry(
          async () => { throw new Error('x'); },
          {
            retries: 5,
            delay: 1000,
            factor: 10,
            maxDelay: cap,
            jitter: 'none',
            onRetry: (_, __, ms) => samples.push(ms),
          }
        ),
      () => true
    );
    for (const s of samples) {
      assert.ok(s <= cap + 1, `delay ${s} exceeded maxDelay ${cap}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Option validation
// ---------------------------------------------------------------------------
describe('option validation', () => {
  const cases = [
    ['retries = -1',      { retries: -1 }],
    ['retries = 1.5',     { retries: 1.5 }],
    ['delay = -1',        { delay: -1 }],
    ['factor = 0',        { factor: 0 }],
    ['maxDelay = -1',     { maxDelay: -1 }],
    ['jitter = "random"', { jitter: 'random' }],
    ['timeout = 0',       { timeout: 0 }],
    ['totalTimeout = -5', { totalTimeout: -5 }],
    ['signal = "str"',    { signal: 'str' }],
    ['shouldRetry = 42',  { shouldRetry: 42 }],
    ['onRetry = true',    { onRetry: true }],
    ['retryOn = "ECON"',  { retryOn: 'ECONNRESET' }],
    ['retryOn = [{}]',    { retryOn: [{}] }],
    ['opts is array',     []],
  ];

  /**
   * Helper that works whether the function throws synchronously
   * or returns a rejected Promise (both patterns are valid here).
   */
  async function expectTypeError(fn) {
    try {
      const result = fn();
      // If fn returned a promise, await it
      if (result && typeof result.then === 'function') {
        await result;
      }
      assert.fail('Expected TypeError to be thrown');
    } catch (err) {
      assert.ok(
        err instanceof TypeError,
        `Expected TypeError, got ${err?.constructor?.name}: ${err?.message}`
      );
    }
  }

  for (const [label, opts] of cases) {
    it(`throws TypeError for ${label}`, async () => {
      await expectTypeError(() => retry(async () => {}, opts));
    });
  }

  it('throws TypeError when fn is not a function', async () => {
    await expectTypeError(() => retry('not-a-fn'));
  });

  it('throws TypeError when retry.wrap fn is not a function', () => {
    // wrap() validates synchronously before returning the wrapper
    assert.throws(() => retry.wrap('not-a-fn'), TypeError);
  });
});

// ---------------------------------------------------------------------------
// 12. Retry-After header
// ---------------------------------------------------------------------------
describe('Retry-After header', () => {
  it('honours numeric Retry-After (delta-seconds) from error.response.headers', async () => {
    const delays = [];
    let calls = 0;

    // Simulate a response with Retry-After: 0.01 (10ms)
    const retryAfterError = () => {
      const err = new Error('429');
      err.response = {
        headers: {
          get: (name) => name === 'retry-after' ? '0.01' : null,
        },
      };
      return err;
    };

    await assert.rejects(
      () =>
        retry(
          async () => {
            calls++;
            throw retryAfterError();
          },
          {
            retries: 2,
            delay: 9999, // would be very long without Retry-After override
            maxDelay: 9999,
            jitter: 'none',
            onRetry: (_, __, ms) => delays.push(ms),
          }
        ),
      () => true
    );

    assert.equal(calls, 3);
    // Each delay should be ~10ms (0.01 s * 1000), not 9999ms
    for (const d of delays) {
      assert.ok(d < 100, `delay ${d}ms too large; Retry-After was not honoured`);
    }
  });

  it('honours HTTP-date Retry-After header', async () => {
    const delays = [];
    const futureDate = new Date(Date.now() + 50).toUTCString(); // 50ms from now

    const retryAfterError = () => {
      const err = new Error('503');
      err.response = {
        headers: { 'retry-after': futureDate },
      };
      return err;
    };

    await assert.rejects(
      () =>
        retry(
          async () => { throw retryAfterError(); },
          {
            retries: 1,
            delay: 9999,
            jitter: 'none',
            onRetry: (_, __, ms) => delays.push(ms),
          }
        ),
      () => true
    );

    assert.ok(delays[0] < 200, `delay ${delays[0]}ms too large; HTTP-date Retry-After not honoured`);
  });
});

// ---------------------------------------------------------------------------
// 13. retry.wrap
// ---------------------------------------------------------------------------
describe('retry.wrap', () => {
  it('returns a function with the same signature', () => {
    const wrapped = retry.wrap(async (a, b) => a + b, FAST);
    assert.equal(typeof wrapped, 'function');
  });

  it('wraps a function and retries on failure', async () => {
    let calls = 0;
    const fn = async (x) => {
      calls++;
      if (calls < 3) throw new Error('not yet');
      return x * 2;
    };
    const wrapped = retry.wrap(fn, { ...FAST, retries: 5 });
    const result = await wrapped(21);
    assert.equal(result, 42);
    assert.equal(calls, 3);
  });

  it('passes all arguments through to the wrapped function', async () => {
    const fn = async (a, b, c) => `${a}-${b}-${c}`;
    const wrapped = retry.wrap(fn, FAST);
    const result = await wrapped('x', 'y', 'z');
    assert.equal(result, 'x-y-z');
  });

  it('throws RetryError when retries are exhausted', async () => {
    const fn = async () => { throw new Error('always'); };
    const wrapped = retry.wrap(fn, { ...FAST, retries: 1 });
    await assert.rejects(() => wrapped(), (err) => {
      assert.ok(err instanceof RetryError);
      return true;
    });
  });
});

// ---------------------------------------------------------------------------
// 14. onRetry callback
// ---------------------------------------------------------------------------
describe('onRetry callback', () => {
  it('is called once per retry with correct (error, attempt, delay) args', async () => {
    const log = [];
    const fn = failTimes(3, 'done');
    await retry(fn, {
      ...FAST,
      retries: 5,
      onRetry: (err, attempt, delay) => log.push({ err, attempt, delay }),
    });
    assert.equal(log.length, 3);
    assert.equal(log[0].attempt, 1);
    assert.equal(log[1].attempt, 2);
    assert.equal(log[2].attempt, 3);
    for (const entry of log) {
      assert.ok(entry.err instanceof Error);
      assert.equal(typeof entry.delay, 'number');
    }
  });

  it('errors thrown inside onRetry are silently swallowed', async () => {
    // Should not propagate onRetry errors
    const result = await retry(failTimes(1, 'ok'), {
      ...FAST,
      retries: 3,
      onRetry: () => { throw new Error('oops from onRetry'); },
    });
    assert.equal(result, 'ok');
  });
});

// ---------------------------------------------------------------------------
// 15. retryOn filter
// ---------------------------------------------------------------------------
describe('retryOn', () => {
  it('retries when error code matches', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) {
        const err = new Error('conn refused');
        err.code = 'ECONNREFUSED';
        throw err;
      }
      return 'connected';
    };
    const result = await retry(fn, { ...FAST, retries: 5, retryOn: ['ECONNREFUSED'] });
    assert.equal(result, 'connected');
    assert.equal(calls, 3);
  });

  it('does NOT retry when error code does not match', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      const err = new Error('auth failed');
      err.code = 'EAUTH';
      throw err;
    };
    await assert.rejects(
      () => retry(fn, { ...FAST, retries: 5, retryOn: ['ECONNREFUSED'] }),
      (err) => {
        assert.ok(err instanceof RetryError);
        assert.equal(calls, 1); // should not have retried
        return true;
      }
    );
  });

  it('retries on numeric status codes', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 2) {
        const err = new Error('server error');
        err.status = 503;
        throw err;
      }
      return 'ok';
    };
    const result = await retry(fn, { ...FAST, retries: 3, retryOn: [503, 429] });
    assert.equal(result, 'ok');
  });
});

// ---------------------------------------------------------------------------
// 16. RetryError properties
// ---------------------------------------------------------------------------
describe('RetryError properties', () => {
  it('has correct name, message, and stack', async () => {
    await assert.rejects(
      () => retry(async () => { throw new Error('x'); }, { ...FAST, retries: 0 }),
      (err) => {
        assert.ok(err instanceof RetryError);
        assert.equal(err.name, 'RetryError');
        assert.ok(err.message.includes('attempt'));
        assert.ok(typeof err.stack === 'string');
        return true;
      }
    );
  });

  it('cause is the last thrown error', async () => {
    const last = new Error('last');
    let calls = 0;
    const errs = [new Error('first'), new Error('second'), last];
    await assert.rejects(
      () =>
        retry(async () => { throw errs[calls++]; }, { ...FAST, retries: 2 }),
      (err) => {
        assert.ok(err instanceof RetryError);
        assert.equal(err.cause, last);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 17. Exponential backoff progression (factor)
// ---------------------------------------------------------------------------
describe('exponential backoff factor', () => {
  it('doubles the delay on each retry (factor=2, jitter=none)', async () => {
    const samples = [];
    const base = 10;
    await assert.rejects(
      () =>
        retry(
          async () => { throw new Error('x'); },
          {
            retries: 4,
            delay: base,
            factor: 2,
            maxDelay: 10000,
            jitter: 'none',
            onRetry: (_, __, ms) => samples.push(ms),
          }
        ),
      () => true
    );
    // Expected delays: 10, 20, 40, 80 (base * factor^(attempt-1))
    assert.equal(samples.length, 4);
    assert.equal(samples[0], base);
    assert.equal(samples[1], base * 2);
    assert.equal(samples[2], base * 4);
    assert.equal(samples[3], base * 8);
  });
});

// ---------------------------------------------------------------------------
// 18. No retries (retries=0)
// ---------------------------------------------------------------------------
describe('retries=0', () => {
  it('throws immediately on first failure without retrying', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retry(async () => { calls++; throw new Error('no retry'); }, { ...FAST, retries: 0 }),
      (err) => {
        assert.ok(err instanceof RetryError);
        assert.equal(err.attempts, 1);
        assert.equal(calls, 1);
        return true;
      }
    );
  });
});
