/**
 * examples/abort-and-wrap.js
 *
 * Demonstrates AbortSignal cancellation and retry.wrap().
 *
 * Run with:
 *   node examples/abort-and-wrap.js
 */

import { retry, AbortError, RetryError } from '@vedant_/retry-kit';

// ---------------------------------------------------------------------------
// Demo 1: AbortController cancellation
// ---------------------------------------------------------------------------
console.log('=== Demo 1: AbortSignal cancellation ===\n');

async function demo1() {
  const controller = new AbortController();

  // Cancel after 1.2 seconds
  setTimeout(() => {
    console.log('  [timeout] Aborting all retries…');
    controller.abort();
  }, 1200);

  try {
    await retry(
      async (attempt) => {
        console.log(`  → Attempt #${attempt}`);
        // Simulate a flaky operation that always fails
        await new Promise((r) => setTimeout(r, 300));
        throw new Error('Service unavailable');
      },
      {
        retries: 10,
        delay: 300,
        factor: 1,
        jitter: 'none',
        signal: controller.signal,
        onRetry: (_, attempt, ms) =>
          console.log(`  ⚠ Will retry in ${ms}ms…`),
      }
    );
  } catch (err) {
    if (err instanceof AbortError) {
      console.log(`\n  ✅ Cleanly aborted: ${err.message}\n`);
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Demo 2: retry.wrap() for a database query
// ---------------------------------------------------------------------------
console.log('=== Demo 2: retry.wrap() ===\n');

let dbCallCount = 0;

/** Simulates a flaky DB query that succeeds on the 3rd call. */
async function queryDatabase(userId) {
  dbCallCount++;
  if (dbCallCount < 3) {
    const err = new Error('Connection reset');
    err.code = 'ECONNRESET';
    throw err;
  }
  return { id: userId, name: 'Vedant', role: 'admin' };
}

const robustQuery = retry.wrap(queryDatabase, {
  retries: 5,
  delay: 100,
  factor: 2,
  jitter: 'equal',
  retryOn: ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'],
  onRetry: (err, attempt, ms) =>
    console.log(`  ⚠ DB error on attempt ${attempt} (${err.code}). Retrying in ${Math.round(ms)}ms…`),
});

async function demo2() {
  try {
    const user = await robustQuery(42);
    console.log(`  ✅ Got user after ${dbCallCount} DB calls:`, user);
  } catch (err) {
    if (err instanceof RetryError) {
      console.error(`  ❌ DB unreachable after ${err.attempts} attempts.`);
    }
  }
}

// Run sequentially
await demo1();
await demo2();
