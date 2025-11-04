import type { Span } from '@opentelemetry/api';
import { INVALID_TRACEID, INVALID_SPANID } from '@opentelemetry/api';

/**
 * Type guard to check if an object is a Span
 * https://github.com/getsentry/sentry-javascript/blob/600e27a62f4931b10ec42fd28a9b5d0929b75808/packages/opentelemetry/test/helpers/isSpan.ts#L4
 */
export function isSpan(value: unknown): value is Span {
  if (
    !(
      typeof value === 'object' &&
      value !== null &&
      'spanContext' in value &&
      typeof value.spanContext === 'function'
    )
  ) {
    return false;
  }

  const ctx = value.spanContext();

  return (
    !!ctx &&
    !!ctx.traceId &&
    ctx.traceId !== INVALID_TRACEID &&
    !!ctx.spanId &&
    ctx.spanId !== INVALID_SPANID
  );
}

// Debug logging state
let debugEnabled = false;

/**
 * Enable debug logging
 */
export function setDebugFlag(debug: boolean): void {
  debugEnabled = debug;
}

/**
 * Conditionally log a debug message if debug is enabled
 */
export function debugLog(...args: unknown[]): void {
  if (debugEnabled) {
    // eslint-disable-next-line no-console
    console.log('[otel-tracing-channel]', ...args);
  }
}
