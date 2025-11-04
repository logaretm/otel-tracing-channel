import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { tracingChannel, setDebugFlag } from '../src';

describe('tracingChannel', () => {
  beforeEach(() => {
    setDebugFlag(false);
  });

  it('should create a tracing channel instance', () => {
    const channel = tracingChannel('test-channel');
    expect(channel).toBeDefined();
    expect(typeof channel.subscribe).toBe('function');
    expect(typeof channel.tracePromise).toBe('function');
    expect(typeof channel.traceSync).toBe('function');
  });

  it('should allow subscribing to channel events', () => {
    const channel = tracingChannel('test-channel');
    const startHandler = vi.fn();
    const endHandler = vi.fn();

    channel.subscribe({
      start: startHandler,
      end: endHandler,
    });

    // Subscribe should not throw
    expect(startHandler).not.toHaveBeenCalled();
  });

  it('should call start and end handlers during traceSync', () => {
    const channel = tracingChannel('test-channel');
    const startHandler = vi.fn();
    const endHandler = vi.fn();

    channel.subscribe({
      start: startHandler,
      end: endHandler,
    });

    const result = channel.traceSync(() => 'hello', {});

    expect(result).toBe('hello');
    expect(startHandler).toHaveBeenCalledTimes(1);
    expect(endHandler).toHaveBeenCalledTimes(1);
  });

  it('should call error handler on sync errors', () => {
    const channel = tracingChannel('test-channel');
    const startHandler = vi.fn();
    const errorHandler = vi.fn();
    const endHandler = vi.fn();

    channel.subscribe({
      start: startHandler,
      error: errorHandler,
      end: endHandler,
    });

    expect(() => {
      channel.traceSync(() => {
        throw new Error('test error');
      }, {});
    }).toThrow('test error');

    expect(startHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(endHandler).toHaveBeenCalledTimes(1);
  });

  it('should call start, asyncStart, asyncEnd, and end handlers during tracePromise', async () => {
    const channel = tracingChannel('test-channel');
    const startHandler = vi.fn();
    const asyncStartHandler = vi.fn();
    const asyncEndHandler = vi.fn();
    const endHandler = vi.fn();

    channel.subscribe({
      start: startHandler,
      asyncStart: asyncStartHandler,
      asyncEnd: asyncEndHandler,
      end: endHandler,
    });

    const result = await channel.tracePromise(async () => 'async hello', {});

    expect(result).toBe('async hello');
    expect(startHandler).toHaveBeenCalledTimes(1);
    expect(asyncStartHandler).toHaveBeenCalledTimes(1);
    expect(asyncEndHandler).toHaveBeenCalledTimes(1);
    expect(endHandler).toHaveBeenCalledTimes(1);
  });

  it('should call error handler on async errors', async () => {
    const channel = tracingChannel('test-channel');
    const startHandler = vi.fn();
    const errorHandler = vi.fn();
    const endHandler = vi.fn();

    channel.subscribe({
      start: startHandler,
      error: errorHandler,
      end: endHandler,
    });

    await expect(
      channel.tracePromise(async () => {
        throw new Error('async test error');
      }, {}),
    ).rejects.toThrow('async test error');

    expect(startHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(endHandler).toHaveBeenCalledTimes(1);
  });

  it('should pass context object to handlers', () => {
    const channel = tracingChannel<{ id: string }>('test-channel');
    const startHandler = vi.fn();
    const endHandler = vi.fn();

    channel.subscribe({
      start: startHandler,
      end: endHandler,
    });

    const context = { id: 'test-123' };
    channel.traceSync(() => 'result', context);

    // Node.js tracing channel passes the context as first arg (may include channel name as second arg)
    expect(startHandler).toHaveBeenCalled();
    expect(startHandler.mock.calls[0][0]).toEqual(context);
    expect(endHandler).toHaveBeenCalled();
    expect(endHandler.mock.calls[0][0]).toEqual(context);
  });

  it('should handle error context with error property', () => {
    const channel = tracingChannel('test-channel');
    const errorHandler = vi.fn();

    channel.subscribe({
      error: errorHandler,
    });

    const testError = new Error('test error');
    const context = { id: 'test' };

    expect(() => {
      channel.traceSync(() => {
        throw testError;
      }, context);
    }).toThrow(testError);

    // Check that error handler was called and first arg contains the error context
    expect(errorHandler).toHaveBeenCalled();
    const errorContext = errorHandler.mock.calls[0][0];
    expect(errorContext).toMatchObject({
      id: 'test',
      error: testError,
    });
  });

  it('should work with no subscribers', async () => {
    const channel = tracingChannel('test-channel');

    // Should not throw
    const syncResult = channel.traceSync(() => 'sync', {});
    expect(syncResult).toBe('sync');

    const asyncResult = await channel.tracePromise(async () => 'async', {});
    expect(asyncResult).toBe('async');
  });

  it('should pass arguments to callback function', async () => {
    const channel = tracingChannel('test-channel');

    const syncResult = channel.traceSync(
      (a: number, b: number) => a + b,
      {},
      5,
      3,
    );
    expect(syncResult).toBe(8);

    const asyncResult = await channel.tracePromise(
      async (str: string, num: number) => `${str}-${num}`,
      {},
      'test',
      42,
    );
    expect(asyncResult).toBe('test-42');
  });

  it('should allow binding and unbinding AsyncLocalStorage', () => {
    const channel = tracingChannel('test-channel');
    const { AsyncLocalStorage } = require('node:async_hooks');
    const storage = new AsyncLocalStorage();

    // Should not throw
    channel.bindStore(storage);
    channel.unbindStore(storage);
  });

  it('should throw when binding non-AsyncLocalStorage', () => {
    const channel = tracingChannel('test-channel');

    expect(() => {
      channel.bindStore({} as any);
    }).toThrow('storage must be an AsyncLocalStorage instance');
  });
});

describe('debug logging integration', () => {
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setDebugFlag(false);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    setDebugFlag(false);
  });

  it('should enable debug logging when set to true', () => {
    setDebugFlag(true);

    // Create a channel which triggers debug logs during setup
    tracingChannel('debug-test-channel');

    // Debug logs should have been called
    expect(consoleLogSpy).toHaveBeenCalled();
    expect(
      consoleLogSpy.mock.calls.some((call) =>
        call.some(
          (arg) =>
            typeof arg === 'string' && arg.includes('[otel-tracing-channel]'),
        ),
      ),
    ).toBe(true);
  });

  it('should not log when debug is disabled', () => {
    setDebugFlag(false);

    tracingChannel('test-channel');

    // Debug logs should not be called (or only for initial setup)
    const debugCalls = consoleLogSpy.mock.calls.filter((call) =>
      call.some(
        (arg) =>
          typeof arg === 'string' && arg.includes('[otel-tracing-channel]'),
      ),
    );

    // With debug disabled, there should be no debug logs
    expect(debugCalls.length).toBe(0);
  });
});

describe('span context injection', () => {
  beforeEach(() => {
    setDebugFlag(false);
  });

  it('should inject span context when start handler returns a span', () => {
    const channel = tracingChannel<{ spanContext?: any }>('test-channel');

    const mockSpan = {
      spanContext: () => ({
        traceId: '12345678901234567890123456789012',
        spanId: '1234567890123456',
      }),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const contextData: { spanContext?: any } = {};

    channel.subscribe({
      start: (_data) => {
        // Return a span from the start handler
        return mockSpan as any;
      },
    });

    channel.traceSync(() => 'result', contextData);

    // The context should have been augmented with __otelSpanContext
    expect((contextData as any).__otelSpanContext).toBeDefined();
  });

  it('should handle start handler that returns void', () => {
    const channel = tracingChannel('test-channel');
    const startHandler = vi.fn(() => {
      // Return void explicitly
      return undefined;
    });

    channel.subscribe({
      start: startHandler,
    });

    // Should not throw
    expect(() => {
      channel.traceSync(() => 'result', {});
    }).not.toThrow();
  });

  it('should handle start handler that returns non-span objects', () => {
    const channel = tracingChannel('test-channel');

    channel.subscribe({
      start: () => {
        // Return a non-span object
        return { notASpan: true } as any;
      },
    });

    // Should not throw, just log a warning (if debug is enabled)
    expect(() => {
      channel.traceSync(() => 'result', {});
    }).not.toThrow();
  });
});

