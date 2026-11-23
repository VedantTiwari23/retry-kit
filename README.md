# @vedant_/retry-kit

[![npm version](https://img.shields.io/npm/v/@vedant_/retry-kit?style=flat-square)](https://www.npmjs.com/package/@vedant_/retry-kit)
[![npm downloads](https://img.shields.io/npm/dm/@vedant_/retry-kit?style=flat-square)](https://www.npmjs.com/package/@vedant_/retry-kit)
[![license](https://img.shields.io/npm/l/@vedant_/retry-kit?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/VedantTiwari23/retry-kit/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/VedantTiwari23/retry-kit/actions)

> A tiny but powerful library to retry async functions with exponential backoff, jitter, timeouts, and cancellation.

---

## Why retry-kit?

Network calls fail. APIs rate-limit. Databases blip. **retry-kit** makes your code resilient with zero fuss:

- 🔁 **Exponential backoff** with configurable factor and base delay
- 🎲 **Three jitter modes** (`full`, `equal`, `none`) to avoid thundering-herd problems
- ⏱ **Per-attempt and total timeouts** so you're never stuck waiting forever
- 🛑 **AbortSignal support** — cancel mid-sleep, not just between attempts
- 📬 **Automatic `Retry-After` handling** (delta-seconds and HTTP-date)
- 🔍 **`retryOn`** to only retry specific error codes or HTTP status codes
- 📣 **`onRetry` callback** for observability and structured logging
- 🛡 **Custom error classes** (`RetryError`, `TimeoutError`, `AbortError`) for precise `catch` handling
- 📦 **Dual-package** (CJS + ESM), **zero runtime dependencies**, **Node ≥ 16**
- 🏷 **Full TypeScript support** with hand-written declarations

---

## Installation

```bash
# npm
npm install @vedant_/retry-kit

# yarn
yarn add @vedant_/retry-kit

# pnpm
pnpm add @vedant_/retry-kit
```

---

## Quick Start

```js
import { retry } from '@vedant_/retry-kit';

// Retry a fetch call up to 4 times with exponential backoff + full jitter
const data = await retry(
  async () => {
    const res = await fetch('https://api.example.com/data');
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.response = res; // enables Retry-After header support
      throw err;
    }
    return res.json();
  },
  {
    retries: 4,
    delay: 500,
    factor: 2,
    maxDelay: 15_000,
    jitter: 'full',
    retryOn: [429, 500, 502, 503, 504],
    onRetry: (err, attempt, ms) =>
      console.warn(`Retry #${attempt} in ${Math.round(ms)}ms — ${err.message}`),
  }
);
```

---

## API Reference

### `retry(fn, options?)` → `Promise<T>`

Runs `fn` and retries on failure using exponential backoff.

- **`fn`** `(attempt: number) => Promise<T>` — The async function to run. Receives the 1-based attempt number.
- **`options`** *(optional)* — See table below.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `retries` | `number` | `3` | Maximum number of **retries** (not counting the initial attempt). Set to `0` to try exactly once. |
| `delay` | `number` | `200` | Base delay in **milliseconds** before the first retry. |
| `factor` | `number` | `2` | Backoff multiplier. Each retry delay is `min(delay × factor^(attempt-1), maxDelay)`. Must be ≥ 1. |
| `maxDelay` | `number` | `30000` | Upper cap on computed delay (ms). Prevents absurdly long waits on high attempt counts. |
| `jitter` | `'none'│'full'│'equal'` | `'full'` | **`none`** — deterministic delay. **`full`** — random in `[0, delay]`. **`equal`** — random in `[delay/2, delay]`. |
| `timeout` | `number` | — | Per-attempt timeout (ms). If a single attempt exceeds this, a `TimeoutError` (`kind='attempt'`) is thrown and the attempt is eligible for retry. |
| `totalTimeout` | `number` | — | Total budget (ms) across all attempts and waits. When exceeded a `TimeoutError` (`kind='total'`) is thrown immediately. |
| `signal` | `AbortSignal` | — | Cancel the entire operation. Abort is honoured **instantly**, even during the sleep between retries. |
| `shouldRetry` | `(err, attempt) => boolean` | — | Return `false` to stop retrying (a `RetryError` is thrown). |
| `onRetry` | `(err, attempt, ms) => void` | — | Called before each sleep. Use for logging. Exceptions inside this callback are silently swallowed. |
| `retryOn` | `(string│number)[]` | — | Only retry if `error.code`, `error.status`, or `error.statusCode` matches one of these values. If omitted, all errors are retried. |

**Returns:** A `Promise<T>` that resolves with the value returned by `fn`, or rejects with one of the custom errors below.

---

### `retry.wrap(fn, options?)` → `typeof fn`

Returns a **new function** with the same signature as `fn` that is automatically retried on failure.

```js
const robustFetch = retry.wrap(fetch, { retries: 3, delay: 300 });
const response = await robustFetch('https://api.example.com'); // ← retried automatically
```

---

### Error Classes

#### `RetryError`
Thrown when all attempts are exhausted.

```js
import { RetryError } from '@vedant_/retry-kit';

try {
  await retry(fn, { retries: 3 });
} catch (err) {
  if (err instanceof RetryError) {
    console.log(err.attempts); // total attempts made
    console.log(err.errors);   // every error thrown, in order
    console.log(err.cause);    // the last error (also Error.cause)
  }
}
```

#### `TimeoutError`
Thrown when a `timeout` or `totalTimeout` is exceeded.

```js
import { TimeoutError } from '@vedant_/retry-kit';

try {
  await retry(fn, { timeout: 1000, totalTimeout: 5000 });
} catch (err) {
  if (err instanceof TimeoutError) {
    console.log(err.kind); // 'attempt' | 'total'
  }
}
```

#### `AbortError`
Thrown when the `signal` fires.

```js
import { AbortError } from '@vedant_/retry-kit';

const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 2000);

try {
  await retry(fn, { signal: ctrl.signal });
} catch (err) {
  if (err instanceof AbortError) {
    console.log('Cancelled!', err.signal.aborted); // true
  }
}
```

---

## Examples

### AbortSignal cancellation

```js
import { retry, AbortError } from '@vedant_/retry-kit';

const controller = new AbortController();
// Cancel after 5 s no matter what
setTimeout(() => controller.abort(), 5000);

try {
  const result = await retry(
    () => fetch('https://api.example.com/slow'),
    { retries: 10, delay: 1000, signal: controller.signal }
  );
} catch (err) {
  if (err instanceof AbortError) console.log('Cancelled by user');
}
```

### Honouring `Retry-After`

retry-kit automatically reads the `Retry-After` header from `error.response.headers` (both Fetch-style `Headers` objects and plain objects) and uses it as the delay instead of the computed backoff.

```js
import { retry } from '@vedant_/retry-kit';

await retry(async () => {
  const res = await fetch('/api/resource');
  if (res.status === 429) {
    const err = new Error('Too Many Requests');
    err.status = 429;
    err.response = res; // ← retry-kit reads res.headers.get('retry-after')
    throw err;
  }
  return res.json();
}, { retries: 5, retryOn: [429] });
```

### `onRetry` for structured logging

```js
import { retry } from '@vedant_/retry-kit';
import pino from 'pino';

const log = pino();

await retry(connectToDatabase, {
  retries: 8,
  delay: 200,
  factor: 2,
  maxDelay: 30_000,
  jitter: 'equal',
  onRetry: (err, attempt, ms) => {
    log.warn({ err, attempt, nextRetryMs: ms }, 'DB connection failed, retrying');
  },
});
```

### `shouldRetry` for conditional retry

```js
import { retry } from '@vedant_/retry-kit';

await retry(callAPI, {
  retries: 5,
  shouldRetry: (err, attempt) => {
    // Don't retry auth errors — they won't self-heal
    if (err.status === 401 || err.status === 403) return false;
    // Don't retry after 3 attempts if the error is a client error
    if (attempt >= 3 && err.status < 500) return false;
    return true;
  },
});
```

---

## TypeScript Usage

```ts
import { retry, RetryError, TimeoutError, AbortError, RetryOptions } from '@vedant_/retry-kit';

interface Post {
  id: number;
  title: string;
}

const options: RetryOptions = {
  retries: 5,
  delay: 300,
  factor: 2,
  jitter: 'full',
  timeout: 10_000,
  retryOn: [429, 503],
};

async function fetchPost(id: number): Promise<Post> {
  return retry<Post>(async (attempt) => {
    const res = await fetch(`/api/posts/${id}`);
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.response = res;
      throw err;
    }
    return res.json();
  }, options);
}

// Wrapped version
const fetchPostRetrying = retry.wrap(fetchPost, options);
```

---

## FAQ

**Q: Does it work with CommonJS (`require`)?**
Yes. The package ships a hand-written CJS build in `dist/cjs/`. Use `require('@vedant_/retry-kit')` in CommonJS projects.

**Q: What Node.js version is required?**
Node ≥ 16. The library uses `AbortController`, `AbortSignal`, and optional chaining — all available since Node 16.

**Q: Does it support timeouts inside `AbortSignal`?**
Yes! You can combine `signal`, `timeout`, and `totalTimeout` simultaneously. The first limit to trigger wins.

**Q: What happens to the AbortSignal when the operation succeeds?**
Nothing — it's left untouched. It only matters if it fires before the operation completes.

**Q: Can I use it with `axios`, `got`, or other HTTP clients?**
Absolutely. The `Retry-After` support reads `error.response.headers` as either a Fetch `Headers` object or a plain key-value object (which `axios` and `got` both provide).

**Q: Does `onRetry` run for the last failure before `RetryError` is thrown?**
No. `onRetry` is only called when there is a next retry scheduled. The final failure throws `RetryError` directly.

---

## Contributing

1. Fork and clone the repo.
2. Run `npm run build && npm test` — ensure all 49 tests pass.
3. Add or update tests for any new behaviour (target >90% coverage).
4. Open a PR against `main`.

---

## Publishing

```bash
# Log in to npm (once)
npm login

# Publish the scoped public package
npm publish --access public
```

---

## License

MIT © vedant_
