import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
  MockInstance,
} from 'vitest';
import { isSpan, setDebugFlag, debugLog } from '../src/utils';
import { INVALID_TRACEID, INVALID_SPANID } from '@opentelemetry/api';

describe('isSpan', () => {
  it('should return true for valid span objects with valid trace and span IDs', () => {
    const mockSpan = {
      spanContext: () => ({
        traceId: '12345678901234567890123456789012',
        spanId: '1234567890123456',
      }),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    expect(isSpan(mockSpan)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isSpan(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isSpan(undefined)).toBe(false);
  });

  it('should return false for primitive values', () => {
    expect(isSpan('string')).toBe(false);
    expect(isSpan(123)).toBe(false);
    expect(isSpan(true)).toBe(false);
  });

  it('should return false for objects without spanContext', () => {
    expect(isSpan({})).toBe(false);
    expect(isSpan({ foo: 'bar' })).toBe(false);
  });

  it('should return false for objects with spanContext but not a function', () => {
    expect(isSpan({ spanContext: 'not a function' })).toBe(false);
    expect(isSpan({ spanContext: 123 })).toBe(false);
    expect(isSpan({ spanContext: {} })).toBe(false);
  });

  it('should return false for span with INVALID_TRACEID', () => {
    const invalidSpan = {
      spanContext: () => ({
        traceId: INVALID_TRACEID,
        spanId: '1234567890123456',
      }),
    };

    expect(isSpan(invalidSpan)).toBe(false);
  });

  it('should return false for span with INVALID_SPANID', () => {
    const invalidSpan = {
      spanContext: () => ({
        traceId: '12345678901234567890123456789012',
        spanId: INVALID_SPANID,
      }),
    };

    expect(isSpan(invalidSpan)).toBe(false);
  });

  it('should return false for span with both invalid IDs', () => {
    const invalidSpan = {
      spanContext: () => ({
        traceId: INVALID_TRACEID,
        spanId: INVALID_SPANID,
      }),
    };

    expect(isSpan(invalidSpan)).toBe(false);
  });

  it('should return false if spanContext returns object without traceId', () => {
    const noTraceIdSpan = {
      spanContext: () => ({
        spanId: '1234567890123456',
      }),
    };

    expect(isSpan(noTraceIdSpan)).toBe(false);
  });

  it('should return false if spanContext returns object without spanId', () => {
    const noSpanIdSpan = {
      spanContext: () => ({
        traceId: '12345678901234567890123456789012',
      }),
    };

    expect(isSpan(noSpanIdSpan)).toBe(false);
  });
});

describe('debugLog', () => {
  let consoleLogSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setDebugFlag(false);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    setDebugFlag(false);
  });

  it('should not log when debug is disabled', () => {
    setDebugFlag(false);
    debugLog('test message');

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should log when debug is enabled', () => {
    setDebugFlag(true);
    debugLog('test message');

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[otel-tracing-channel]',
      'test message',
    );
  });

  it('should log multiple arguments', () => {
    setDebugFlag(true);
    debugLog('message', 123, { foo: 'bar' });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[otel-tracing-channel]',
      'message',
      123,
      { foo: 'bar' },
    );
  });

  it('should respect debug flag changes', () => {
    setDebugFlag(false);
    debugLog('should not log');
    expect(consoleLogSpy).not.toHaveBeenCalled();

    setDebugFlag(true);
    debugLog('should log');
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);

    setDebugFlag(false);
    debugLog('should not log again');
    expect(consoleLogSpy).toHaveBeenCalledTimes(1); // Still only 1 call
  });
});

describe('setDebugFlag', () => {
  let consoleLogSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setDebugFlag(false);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    setDebugFlag(false);
  });

  it('should enable debug logging', () => {
    setDebugFlag(true);
    debugLog('test');
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('should disable debug logging', () => {
    setDebugFlag(true);
    setDebugFlag(false);
    debugLog('test');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should handle multiple calls', () => {
    setDebugFlag(true);
    setDebugFlag(true);
    debugLog('test');
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);

    consoleLogSpy.mockClear();
    setDebugFlag(false);
    setDebugFlag(false);
    debugLog('test');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
