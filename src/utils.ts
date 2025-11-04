import type { Span } from '@opentelemetry/api';

/**
 * Type guard to check if an object is a Span
 */
export function isSpan(value: unknown): value is Span {
  return (
    typeof value === 'object' &&
    value !== null &&
    'spanContext' in value &&
    typeof (value as Span).spanContext === 'function'
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
