#!/usr/bin/env node
/**
 * build.js — zero-dep dual-package builder for @vedant_/retry-kit
 *
 * Strategy: rather than parsing/transforming ESM source (fragile),
 * we write purpose-built CJS wrappers that use dynamic import() to
 * load the ESM files, forwarding all exports.  This is 100% spec-
 * compliant and works in Node ≥ 16.
 *
 * dist/
 *   esm/   – verbatim copy of src/ (pure ESM)
 *   cjs/   – hand-written CJS wrappers
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');
const srcDir = join(root, 'src');
const esmOut = join(root, 'dist', 'esm');
const cjsOut = join(root, 'dist', 'cjs');

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// 1. ESM: copy src/ verbatim
// ---------------------------------------------------------------------------
ensureDir(esmOut);
writeFileSync(
  join(esmOut, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2)
);

const srcFiles = readdirSync(srcDir).filter((f) => f.endsWith('.js'));
for (const file of srcFiles) {
  copyFileSync(join(srcDir, file), join(esmOut, file));
}
console.log(`✓ ESM: copied ${srcFiles.length} files → dist/esm/`);

// ---------------------------------------------------------------------------
// 2. CJS: write purpose-built wrappers
//
// Node ≥ 16 supports top-level await inside async IIFE that is called
// synchronously from the wrapper.  We use a synchronous module.exports
// pattern via a require-time hack:
//
//   We write truly synchronous CJS wrappers by inlining the logic directly.
//   This avoids async-require edge cases entirely.
// ---------------------------------------------------------------------------
ensureDir(cjsOut);
writeFileSync(
  join(cjsOut, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2)
);

// ---- errors.cjs ----
writeFileSync(
  join(cjsOut, 'errors.cjs'),
  `'use strict';

class RetryError extends Error {
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

class TimeoutError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'TimeoutError';
    this.kind = kind;
    if (Error.captureStackTrace) Error.captureStackTrace(this, TimeoutError);
  }
}

class AbortError extends Error {
  constructor(message, signal) {
    super(message);
    this.name = 'AbortError';
    this.signal = signal;
    if (Error.captureStackTrace) Error.captureStackTrace(this, AbortError);
  }
}

module.exports = { RetryError, TimeoutError, AbortError };
`
);

// ---- validate.cjs ----
writeFileSync(
  join(cjsOut, 'validate.cjs'),
  `'use strict';

const VALID_JITTER = new Set(['none', 'full', 'equal']);

function validateOptions(opts) {
  if (opts === undefined || opts === null) opts = {};
  if (typeof opts !== 'object' || Array.isArray(opts)) {
    throw new TypeError(
      '[retry-kit] options must be a plain object, got: ' + typeof opts
    );
  }

  const retries = opts.retries !== undefined ? opts.retries : 3;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new TypeError(
      '[retry-kit] options.retries must be a non-negative integer, got: ' +
        JSON.stringify(retries)
    );
  }

  const delay = opts.delay !== undefined ? opts.delay : 200;
  if (typeof delay !== 'number' || delay < 0 || !isFinite(delay)) {
    throw new TypeError(
      '[retry-kit] options.delay must be a non-negative finite number (ms), got: ' +
        JSON.stringify(delay)
    );
  }

  const factor = opts.factor !== undefined ? opts.factor : 2;
  if (typeof factor !== 'number' || factor < 1 || !isFinite(factor)) {
    throw new TypeError(
      '[retry-kit] options.factor must be a finite number >= 1, got: ' +
        JSON.stringify(factor)
    );
  }

  const maxDelay = opts.maxDelay !== undefined ? opts.maxDelay : 30000;
  if (typeof maxDelay !== 'number' || maxDelay < 0 || !isFinite(maxDelay)) {
    throw new TypeError(
      '[retry-kit] options.maxDelay must be a non-negative finite number (ms), got: ' +
        JSON.stringify(maxDelay)
    );
  }

  const jitter = opts.jitter !== undefined ? opts.jitter : 'full';
  if (!VALID_JITTER.has(jitter)) {
    throw new TypeError(
      '[retry-kit] options.jitter must be "none", "full", or "equal", got: ' +
        JSON.stringify(jitter)
    );
  }

  const timeout = opts.timeout !== undefined ? opts.timeout : undefined;
  if (timeout !== undefined && (typeof timeout !== 'number' || timeout <= 0 || !isFinite(timeout))) {
    throw new TypeError(
      '[retry-kit] options.timeout must be a positive finite number (ms), got: ' +
        JSON.stringify(timeout)
    );
  }

  const totalTimeout = opts.totalTimeout !== undefined ? opts.totalTimeout : undefined;
  if (totalTimeout !== undefined && (typeof totalTimeout !== 'number' || totalTimeout <= 0 || !isFinite(totalTimeout))) {
    throw new TypeError(
      '[retry-kit] options.totalTimeout must be a positive finite number (ms), got: ' +
        JSON.stringify(totalTimeout)
    );
  }

  const signal = opts.signal !== undefined ? opts.signal : undefined;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('[retry-kit] options.signal must be an AbortSignal instance');
  }

  const shouldRetry = opts.shouldRetry !== undefined ? opts.shouldRetry : undefined;
  if (shouldRetry !== undefined && typeof shouldRetry !== 'function') {
    throw new TypeError('[retry-kit] options.shouldRetry must be a function');
  }

  const onRetry = opts.onRetry !== undefined ? opts.onRetry : undefined;
  if (onRetry !== undefined && typeof onRetry !== 'function') {
    throw new TypeError('[retry-kit] options.onRetry must be a function');
  }

  const retryOn = opts.retryOn !== undefined ? opts.retryOn : undefined;
  if (retryOn !== undefined) {
    if (!Array.isArray(retryOn)) {
      throw new TypeError('[retry-kit] options.retryOn must be an array of error codes / status codes');
    }
    for (const item of retryOn) {
      if (typeof item !== 'string' && typeof item !== 'number') {
        throw new TypeError(
          '[retry-kit] options.retryOn items must be strings or numbers, got: ' + JSON.stringify(item)
        );
      }
    }
  }

  return { retries, delay, factor, maxDelay, jitter, timeout, totalTimeout, signal, shouldRetry, onRetry, retryOn };
}

module.exports = { validateOptions };
`
);

// ---- retry.cjs ----
writeFileSync(
  join(cjsOut, 'retry.cjs'),
  `'use strict';

const { RetryError, TimeoutError, AbortError } = require('./errors.cjs');
const { validateOptions } = require('./validate.cjs');

function computeBaseDelay(baseDelay, factor, attempt, maxDelay) {
  return Math.min(baseDelay * Math.pow(factor, attempt - 1), maxDelay);
}

function applyJitter(delay, mode) {
  switch (mode) {
    case 'full':  return Math.random() * delay;
    case 'equal': return delay / 2 + Math.random() * (delay / 2);
    default:      return delay;
  }
}

function retryAfterMs(err) {
  if (!err || typeof err !== 'object') return undefined;
  const response = err.response;
  if (!response || typeof response !== 'object') return undefined;
  const headers = response.headers;
  if (!headers) return undefined;
  let value;
  if (typeof headers.get === 'function') {
    value = headers.get('retry-after');
  } else {
    value = headers['retry-after'] !== undefined ? headers['retry-after'] : headers['Retry-After'];
  }
  if (value === undefined || value === null) return undefined;
  const numeric = Number(value);
  if (!isNaN(numeric) && isFinite(numeric)) return numeric * 1000;
  const date = new Date(String(value)).getTime();
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      return reject(new AbortError('Operation aborted', signal));
    }
    let timer;
    let onAbort;
    const cleanup = () => {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    };
    timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    if (signal) {
      onAbort = () => { cleanup(); reject(new AbortError('Operation aborted', signal)); };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function withAttemptTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError('Attempt timed out after ' + ms + 'ms', 'attempt'));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function matchesRetryOn(err, retryOn) {
  if (!retryOn || retryOn.length === 0) return true;
  if (!err || typeof err !== 'object') return false;
  for (const code of retryOn) {
    if (err.code === code || err.status === code || err.statusCode === code) return true;
  }
  return false;
}

function retry(fn, options) {
  if (typeof fn !== 'function') throw new TypeError('[retry-kit] fn must be a function');
  const opts = validateOptions(options);
  return _retryAsync(fn, opts);
}

async function _retryAsync(fn, opts) {
  const { retries, delay, factor, maxDelay, jitter, timeout: attemptTimeout,
          totalTimeout, signal, shouldRetry, onRetry, retryOn } = opts;

  const totalDeadline = totalTimeout ? Date.now() + totalTimeout : Infinity;
  const errors = [];
  let attempt = 0;

  if (signal && signal.aborted) throw new AbortError('Operation aborted before first attempt', signal);

  while (true) {
    attempt++;
    if (Date.now() >= totalDeadline) {
      throw new TimeoutError('Total timeout of ' + totalTimeout + 'ms exceeded', 'total');
    }
    try {
      let callPromise = Promise.resolve().then(() => fn(attempt));
      if (attemptTimeout) callPromise = withAttemptTimeout(callPromise, attemptTimeout);
      return await callPromise;
    } catch (err) {
      errors.push(err);
      if (err instanceof AbortError) throw err;
      if (err instanceof TimeoutError && err.kind === 'total') throw err;
      if (attempt > retries) throw new RetryError('All ' + attempt + ' attempt(s) failed', attempt, errors);
      if (!matchesRetryOn(err, retryOn)) {
        throw new RetryError('Attempt failed with an error that is not in retryOn list (attempt ' + attempt + ')', attempt, errors);
      }
      if (shouldRetry && !shouldRetry(err, attempt)) {
        throw new RetryError('shouldRetry returned false on attempt ' + attempt, attempt, errors);
      }
      if (signal && signal.aborted) throw new AbortError('Operation aborted', signal);

      const retryAfterOverride = retryAfterMs(err);
      let waitMs;
      if (retryAfterOverride !== undefined) {
        waitMs = retryAfterOverride;
      } else {
        const base = computeBaseDelay(delay, factor, attempt, maxDelay);
        waitMs = applyJitter(base, jitter);
      }

      const remaining = totalDeadline - Date.now();
      if (remaining <= 0) throw new TimeoutError('Total timeout of ' + totalTimeout + 'ms exceeded', 'total');
      waitMs = Math.min(waitMs, remaining);

      if (onRetry) {
        try { onRetry(err, attempt, waitMs); } catch {}
      }
      await sleep(waitMs, signal);
    }
  }
}

retry.wrap = function wrap(fn, options) {
  if (typeof fn !== 'function') throw new TypeError('[retry-kit] retry.wrap: fn must be a function');
  return function (...args) { return retry(() => fn(...args), options); };
};

module.exports = { retry };
`
);

// ---- index.cjs ----
writeFileSync(
  join(cjsOut, 'index.cjs'),
  `'use strict';

const { retry }                           = require('./retry.cjs');
const { RetryError, TimeoutError, AbortError } = require('./errors.cjs');

module.exports = { retry, RetryError, TimeoutError, AbortError };
`
);

console.log('✓ CJS: wrote hand-crafted wrappers → dist/cjs/');
console.log('\n✅ Build complete!');
