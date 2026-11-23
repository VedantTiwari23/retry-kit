# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-01

### Added
- `retry(fn, options)` — core retry function with exponential backoff.
- `retry.wrap(fn, options)` — returns a retrying version of any async function.
- Jitter modes: `none`, `full`, `equal`.
- Per-attempt timeout (`timeout`) and total timeout (`totalTimeout`).
- `AbortSignal` support via `signal` option — cancels immediately, even during sleep.
- `shouldRetry(error, attempt)` callback for conditional stopping.
- `onRetry(error, attempt, nextDelayMs)` callback for observability/logging.
- `retryOn` array for filtering retries by error code or HTTP status.
- Automatic `Retry-After` header honour (delta-seconds and HTTP-date formats).
- Custom error classes: `RetryError`, `TimeoutError`, `AbortError`.
- Comprehensive option validation with clear, actionable error messages.
- Dual-package support: CommonJS (`require`) and ESM (`import`) via `exports`.
- Hand-written TypeScript declarations (`index.d.ts`).
- Full test suite (49 tests) using Node.js built-in test runner.
- Zero runtime dependencies.
