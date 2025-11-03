/**
 * Fixed wrapper around Node.js's tracingChannel that properly propagates context
 * 
 * This fixes the bug where context is lost between the start event and tracePromise callback
 * by running the callback in the context stored by the start event handler.
 */

import { tracingChannel as nativeTracingChannel, type TracingChannel, type TracingChannelSubscribers } from 'node:diagnostics_channel';
import { AsyncLocalStorage } from 'node:async_hooks';
import { context as otelContext } from '@opentelemetry/api';


export class TracingChannelFixed<ContextType extends object = object> {
  private _channel: TracingChannel<ContextType, ContextType>;
  private _boundStores = new Set<AsyncLocalStorage<any>>();

  constructor(name: string) {
    // Use Node.js's built-in tracingChannel to get the underlying channels
    this._channel = nativeTracingChannel<ContextType, ContextType>(name);
  }
  
  /**
   * Bind an AsyncLocalStorage to this tracing channel
   * This allows automatic context propagation
   */
  bindStore(storage: AsyncLocalStorage<any>): void {
    if (!(storage instanceof AsyncLocalStorage)) {
      throw new TypeError('storage must be an AsyncLocalStorage instance');
    }
    
    this._boundStores.add(storage);
    
    // Also bind to the underlying channels so runStores works
    this._channel.start.bindStore(storage);
    this._channel.asyncStart.bindStore(storage);
    this._channel.asyncEnd.bindStore(storage);
    this._channel.end.bindStore(storage);
    this._channel.error.bindStore(storage);
  }
  
  /**
   * Unbind an AsyncLocalStorage from this tracing channel
   */
  unbindStore(storage: AsyncLocalStorage<any>): void {
    this._boundStores.delete(storage);
    
    this._channel.start.unbindStore(storage);
    this._channel.asyncStart.unbindStore(storage);
    this._channel.asyncEnd.unbindStore(storage);
    this._channel.end.unbindStore(storage);
    this._channel.error.unbindStore(storage);
  }
  
  /**
   * Subscribe to tracing channel events
   */
  subscribe(subscribers: TracingChannelSubscribers<ContextType>): void {
    this._channel.subscribe(subscribers);
  }
  
  /**
   * Unsubscribe from tracing channel events
   */
  unsubscribe(subscribers: TracingChannelSubscribers<ContextType>): void {
    this._channel.unsubscribe(subscribers);
  }
  
  /**
   * 🔥 FIXED: tracePromise that properly propagates context
   * 
   * This overrides the native implementation to run the callback in the context
   * stored by the start event handler (via _spanContext).
   */
  async tracePromise<Args extends any[], Return>(
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
      const spanContext = (context as any)._spanContext;
      
      if (spanContext) {
        // Get the context manager and run callback in the stored context
        const contextManager = (otelContext as any)._getContextManager();
        
        if (contextManager?._asyncLocalStorage) {
          console.log('🔥 Running callback in span context');
          result = await contextManager._asyncLocalStorage.run(spanContext, async () => {
            return await callback(...args);
          });
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
        this._channel.error.publish({ ...context, error } as any);
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
  traceSync<Args extends any[], Return>(
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
        this._channel.error.publish({ ...context, error } as any);
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
 * Factory function to create a fixed tracing channel
 */
export function tracingChannel<ContextType extends object>(
  name: string
): TracingChannelFixed<ContextType> {
  return new TracingChannelFixed<ContextType>(name);
}
