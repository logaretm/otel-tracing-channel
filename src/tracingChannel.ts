import {
  tracingChannel as nativeTracingChannel,
  type TracingChannel as NativeTracingChannel,
  type TracingChannelSubscribers,
} from 'node:diagnostics_channel';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  context as otelContext,
  trace,
  type Span,
  type Context,
} from '@opentelemetry/api';
import { prepChannel } from './prepChannel';
import { isSpan, debugLog } from './utils';

// Partial subscribers type - all handlers are optional
export type PartialTracingChannelSubscribers<ContextType extends object> =
  Partial<TracingChannelSubscribers<ContextType>>;

// Extended context type that includes our injected span context
type ContextWithSpanContext<T extends object> = T & {
  __otelSpanContext?: Context;
};

// Extended error context type
type ErrorContext<T extends object> = T & {
  error: unknown;
};

// Type for context manager with AsyncLocalStorage
interface ContextManagerWithStorage {
  _asyncLocalStorage?: AsyncLocalStorage<Context>;
}

// Type for start handler that can optionally return a span
type StartHandler<T> = ((data: T) => void) | ((data: T) => Span | void);

class TracingChannel<ContextType extends object = object> {
  private _channel: NativeTracingChannel<ContextType, ContextType>;
  private _boundStores = new Set<AsyncLocalStorage<unknown>>();

  constructor(name: string) {
    // Use Node.js's built-in tracingChannel to get the underlying channels
    this._channel = nativeTracingChannel<ContextType, ContextType>(name);
  }

  /**
   * Bind an AsyncLocalStorage to this tracing channel
   * This allows automatic context propagation
   */
  bindStore<T = unknown>(storage: AsyncLocalStorage<T>): void {
    if (!(storage instanceof AsyncLocalStorage)) {
      throw new TypeError('storage must be an AsyncLocalStorage instance');
    }

    this._boundStores.add(storage);

    // Also bind to the underlying channels so runStores works
    // Type assertion is safe here because Node.js accepts AsyncLocalStorage of any type
    const typedStorage = storage as unknown as AsyncLocalStorage<ContextType>;
    this._channel.start.bindStore(typedStorage);
    this._channel.asyncStart.bindStore(typedStorage);
    this._channel.asyncEnd.bindStore(typedStorage);
    this._channel.end.bindStore(typedStorage);
    this._channel.error.bindStore(typedStorage);
  }

  /**
   * Unbind an AsyncLocalStorage from this tracing channel
   */
  unbindStore<T = unknown>(storage: AsyncLocalStorage<T>): void {
    this._boundStores.delete(storage);

    // Type assertion is safe here because Node.js accepts AsyncLocalStorage of any type
    const typedStorage = storage as unknown as AsyncLocalStorage<ContextType>;
    this._channel.start.unbindStore(typedStorage);
    this._channel.asyncStart.unbindStore(typedStorage);
    this._channel.asyncEnd.unbindStore(typedStorage);
    this._channel.end.unbindStore(typedStorage);
    this._channel.error.unbindStore(typedStorage);
  }

  /**
   * Subscribe to tracing channel events
   *
   * 🔥 Enhanced: If the start handler returns a span, automatically inject _spanContext
   */
  subscribe(subscribers: PartialTracingChannelSubscribers<ContextType>): void {
    const wrappedSubscribers = { ...subscribers };

    // Wrap the start handler to auto-inject _spanContext if a span is returned
    if (subscribers.start) {
      const originalStart = subscribers.start as StartHandler<ContextType>;
      wrappedSubscribers.start = (data: ContextType) => {
        const result = originalStart(data);

        // If start handler returns a span, auto-inject the context
        if (isSpan(result)) {
          const newContext = trace.setSpan(otelContext.active(), result);
          (data as ContextWithSpanContext<ContextType>).__otelSpanContext =
            newContext;
        } else {
          debugLog('⚠️  Start handler returned a non-span value, context may not be propagated.');
        }

        return result;
      };
    }

    this._channel.subscribe(
      wrappedSubscribers as TracingChannelSubscribers<ContextType>,
    );
  }

  /**
   * Unsubscribe from tracing channel events
   */
  unsubscribe(
    subscribers: PartialTracingChannelSubscribers<ContextType>,
  ): void {
    this._channel.unsubscribe(
      subscribers as TracingChannelSubscribers<ContextType>,
    );
  }

  /**
   * 🔥 FIXED: tracePromise that properly propagates context
   *
   * This overrides the native implementation to run the callback in the context
   * stored by the start event handler (via _spanContext).
   */
  async tracePromise<Args extends unknown[], Return>(
    callback: (...args: Args) => Promise<Return> | Return,
    context: ContextType,
    ...args: Args
  ): Promise<Return> {
    if (!this._channel.hasSubscribers) {
      return await callback(...args);
    }

    // Publish start event - handlers should set up context in the data
    if (this._channel.start.hasSubscribers) {
      this._channel.start.publish(context);
    }
    if (this._channel.asyncStart.hasSubscribers) {
      this._channel.asyncStart.publish(context);
    }

    try {
      // 🔥 KEY FIX: If start handler stored a context, run callback in that context
      let result: Return;
      const extendedContext = context as ContextWithSpanContext<ContextType>;
      const spanContext = extendedContext.__otelSpanContext;

      if (spanContext) {
        // Get the context manager and run callback in the stored context
        const contextManager = (
          otelContext as unknown as {
            _getContextManager: () => ContextManagerWithStorage;
          }
        )._getContextManager();

        if (contextManager._asyncLocalStorage) {
          debugLog('🔥 Running callback in span context');
          result = await contextManager._asyncLocalStorage.run(
            spanContext,
            async () => {
              return await callback(...args);
            },
          );
        } else {
          result = await callback(...args);
        }
      } else {
        // No special context, just execute normally
        result = await callback(...args);
      }

      // Publish asyncEnd event
      if (this._channel.asyncEnd.hasSubscribers) {
        this._channel.asyncEnd.publish(context);
      }

      // Publish end event
      if (this._channel.end.hasSubscribers) {
        this._channel.end.publish(context);
      }

      return result;
    } catch (error) {
      // Publish error event
      if (this._channel.error.hasSubscribers) {
        const errorContext: ErrorContext<ContextType> = { ...context, error };
        this._channel.error.publish(errorContext);
      }

      // Publish end event even on error
      if (this._channel.end.hasSubscribers) {
        this._channel.end.publish(context);
      }

      throw error;
    }
  }

  /**
   * Synchronous version of trace (for completeness)
   */
  traceSync<Args extends unknown[], Return>(
    callback: (...args: Args) => Return,
    context: ContextType,
    ...args: Args
  ): Return {
    if (!this._channel.hasSubscribers) {
      return callback(...args);
    }

    // Publish start event
    if (this._channel.start.hasSubscribers) {
      this._channel.start.publish(context);
    }

    try {
      const result = callback(...args);

      // Publish end event
      if (this._channel.end.hasSubscribers) {
        this._channel.end.publish(context);
      }

      return result;
    } catch (error) {
      // Publish error event
      if (this._channel.error.hasSubscribers) {
        const errorContext: ErrorContext<ContextType> = { ...context, error };
        this._channel.error.publish(errorContext);
      }

      // Publish end event even on error
      if (this._channel.end.hasSubscribers) {
        this._channel.end.publish(context);
      }

      throw error;
    }
  }
}

/**
 * Fixed wrapper around Node.js's tracingChannel that properly propagates context
 *
 * This fixes the bug where context is lost between the start event and tracePromise callback
 * by running the callback in the context stored by the start event handler.
 */
export function tracingChannel<ContextType extends object>(name: string) {
  return prepChannel(new TracingChannel<ContextType>(name));
}

/**
 * Only export the type of the tracing channel.
 */
export type { TracingChannel };
