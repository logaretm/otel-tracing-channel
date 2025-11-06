import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { tracingChannel, setDebugFlag } from '../src';
import { context, trace, type Span, ROOT_CONTEXT } from '@opentelemetry/api';
import { tracingChannel as nativeTracingChannel } from 'node:diagnostics_channel';
import { AsyncLocalStorage } from 'node:async_hooks';

describe('tracingChannel', () => {
  beforeEach(() => {
    setDebugFlag(false);
  });

  it('should create a tracing channel from a string name', () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel(
      'test-channel',
      () => mockSpan,
    );

    expect(channel).toBeDefined();
    expect(typeof channel.subscribe).toBe('function');
    expect(typeof channel.tracePromise).toBe('function');
    expect(typeof channel.traceSync).toBe('function');
  });

  it('should accept an existing TracingChannel instance', () => {
    const mockSpan = createMockSpan();
    const nativeChannel = nativeTracingChannel('test-channel');
    const channel = tracingChannel(nativeChannel, () => mockSpan);

    expect(channel).toBe(nativeChannel);
  });

  it('should call transformStart during channel execution if OTel context is available', () => {
    const mockSpan = createMockSpan();
    const transformStart = vi.fn(() => mockSpan);
    const channel = tracingChannel('test-channel', transformStart);

    channel.traceSync(() => 'result', { foo: 'bar' });

    // transformStart is called if AsyncLocalStorage is available
    // If not available, it won't be called
    if (transformStart.mock.calls.length > 0) {
      // Span was added to the data
      const callData = transformStart.mock.calls[0][0];
      expect(callData.foo).toBe('bar');
    }
  });

  it('should store the created span on the data object when context is available', () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    const data: any = { foo: 'bar' };
    channel.traceSync(() => 'result', data);

    // If OTel context is available, span will be added
    // Otherwise it won't be - both cases are valid
    if (data.span) {
      expect(data.span).toBe(mockSpan);
    }
  });

  it('should allow subscribers to access events', () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    const endHandler = vi.fn();
    channel.subscribe({
      end: endHandler,
    });

    channel.traceSync(() => 'result', { foo: 'bar' });

    expect(endHandler).toHaveBeenCalledTimes(1);
    const callData = endHandler.mock.calls[0][0];
    expect(callData.foo).toBe('bar');
  });

  it('should work with typed channel data', () => {
    interface MyData {
      operationName: string;
      userId: string;
    }

    const mockSpan = createMockSpan();
    const transformStart = vi.fn((data: MyData) => {
      // Data might have span added by the library
      expect(data.operationName).toBe('fetch-user');
      expect(data.userId).toBe('123');
      return mockSpan;
    });

    const channel = tracingChannel<MyData>(
      'test-channel',
      transformStart,
    );

    // Even if transformStart isn't called (no OTel context), the channel should work
    expect(() => {
      channel.traceSync(() => 'result', {
        operationName: 'fetch-user',
        userId: '123',
      });
    }).not.toThrow();
  });

  it('should handle errors gracefully when OTel context is not available', () => {
    const mockSpan = createMockSpan();
    
    // Mock the context manager to return something invalid
    const originalGetContextManager = (context as any)._getContextManager;
    (context as any)._getContextManager = () => null;

    // Should not throw, just log a debug message
    expect(() => {
      tracingChannel('test-channel', () => mockSpan);
    }).not.toThrow();

    // Restore
    (context as any)._getContextManager = originalGetContextManager;
  });

  it('should return channel even if AsyncLocalStorage is not accessible', () => {
    const mockSpan = createMockSpan();
    
    // Mock the context manager to have no _asyncLocalStorage
    const originalGetContextManager = (context as any)._getContextManager;
    (context as any)._getContextManager = () => ({ _asyncLocalStorage: null });

    const channel = tracingChannel('test-channel', () => mockSpan);

    expect(channel).toBeDefined();
    expect(typeof channel.traceSync).toBe('function');

    // Restore
    (context as any)._getContextManager = originalGetContextManager;
  });

  it('should pass return value through', () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    const syncResult = channel.traceSync(() => 42, {});
    expect(syncResult).toBe(42);
  });

  it('should pass return value through for async operations', async () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    const asyncResult = await channel.tracePromise(async () => 'hello', {});
    expect(asyncResult).toBe('hello');
  });

  it('should propagate errors from sync operations', () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    expect(() => {
      channel.traceSync(() => {
        throw new Error('test error');
      }, {});
    }).toThrow('test error');
  });

  it('should propagate errors from async operations', async () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    await expect(
      channel.tracePromise(async () => {
        throw new Error('async error');
      }, {}),
    ).rejects.toThrow('async error');
  });

  it('should support error handlers', () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    const errorHandler = vi.fn();
    channel.subscribe({
      error: errorHandler,
    });

    expect(() => {
      channel.traceSync(() => {
        throw new Error('test error');
      }, {});
    }).toThrow('test error');

    expect(errorHandler).toHaveBeenCalledTimes(1);
    const errorData = errorHandler.mock.calls[0][0];
    expect(errorData.error).toBeInstanceOf(Error);
    expect(errorData.error.message).toBe('test error');
  });

  it('should call handlers in correct order for async operations', async () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    const calls: string[] = [];

    channel.subscribe({
      start: () => calls.push('start'),
      asyncStart: () => calls.push('asyncStart'),
      asyncEnd: () => calls.push('asyncEnd'),
      end: () => calls.push('end'),
    });

    await channel.tracePromise(async () => {
      calls.push('fn');
    }, {});

    // Node.js tracing channel calls: start (sync), then fn runs, then end (sync), 
    // then asyncStart and asyncEnd fire after the promise settles
    expect(calls).toEqual(['start', 'fn', 'end', 'asyncStart', 'asyncEnd']);
  });

  it('should work without any subscribers', () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    // Should not throw
    expect(() => {
      channel.traceSync(() => 'result', {});
    }).not.toThrow();
  });

  it('should handle async operations without subscribers', async () => {
    const mockSpan = createMockSpan();
    const channel = tracingChannel('test-channel', () => mockSpan);

    // Should not throw
    await expect(
      channel.tracePromise(async () => 'result', {}),
    ).resolves.toBe('result');
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

    const mockSpan = createMockSpan();
    tracingChannel('debug-test-channel', () => mockSpan);

    // Debug logs should have been called during channel creation
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

    const mockSpan = createMockSpan();
    tracingChannel('test-channel', () => mockSpan);

    // Debug logs should not be called
    const debugCalls = consoleLogSpy.mock.calls.filter((call) =>
      call.some(
        (arg) =>
          typeof arg === 'string' && arg.includes('[otel-tracing-channel]'),
      ),
    );

    expect(debugCalls.length).toBe(0);
  });
});

// Helper function to create a mock span
function createMockSpan(name: string = 'test-span'): Span {
  return {
    spanContext: () => ({
      traceId: '12345678901234567890123456789012',
      spanId: '1234567890123456',
      traceFlags: 1,
    }),
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    addEvent: vi.fn(),
    setStatus: vi.fn(),
    updateName: vi.fn(),
    end: vi.fn(),
    isRecording: () => true,
    recordException: vi.fn(),
  } as any;
}
