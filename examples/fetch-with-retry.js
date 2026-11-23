/**
 * examples/fetch-with-retry.js
 *
 * Real-world example: retrying a fetch() call with logging.
 *
 * Run with:
 *   node examples/fetch-with-retry.js
 */

import { retry } from '@vedant_/retry-kit';

const API_URL = 'https://jsonplaceholder.typicode.com/todos/1';

async function main() {
  console.log('Fetching with retry-kit…\n');

  const data = await retry(
    async (attempt) => {
      console.log(`  → Attempt #${attempt}: GET ${API_URL}`);
      const res = await fetch(API_URL);

      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        err.status = res.status;
        // Preserve the response so retry-kit can read Retry-After
        err.response = res;
        throw err;
      }

      return res.json();
    },
    {
      retries: 4,
      delay: 500,
      factor: 2,
      maxDelay: 10_000,
      jitter: 'full',
      retryOn: [429, 500, 502, 503, 504],
      onRetry: (err, attempt, nextDelay) => {
        console.log(
          `  ⚠ Attempt ${attempt} failed: ${err.message}. ` +
          `Retrying in ${Math.round(nextDelay)}ms…`
        );
      },
    }
  );

  console.log('\n✅ Success!\n', JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error('\n❌ All attempts failed:', err.message);
  if (err.errors) {
    console.error('Individual errors:', err.errors.map((e) => e.message));
  }
  process.exit(1);
});
