import { tracingChannel as nativeTracingChannel } from 'node:diagnostics_channel';
import type { TracingChannel } from 'node:diagnostics_channel';
import { context, trace, type Span } from '@opentelemetry/api';
import { debugLog, isSpan } from './utils';

/**
 * Transform function that creates a span from the channel data
 */
export type TracingChannelTransform<TData = any> = (data: TData) => Span;

type WithSpan<TData = any> = TData & { span?: Span };

/**
 * Creates a new tracing channel with proper context propagation
 *
 * @param channelNameOrInstance - Either a channel name string or an existing TracingChannel instance.
 * @param transformStart - Function that creates an OpenTelemetry span from the channel data.
 * @returns The tracing channel with OTel context bound
 *
 * @example
 * ```ts
 * import { tracingChannel } from 'otel-tracing-channel';
 * import * as Sentry from '@sentry/node';
 *
 * const channel = tracingChannel(
 *   'some:channel:name',
 *   (data) => {
 *     return Sentry.startSpanManual(
 *       {
 *         name: 'my-operation',
 *         op: data.op,
 *         attributes: { key: data.key }
 *       },
 *       (span) => span
 *     );
 *   }
 * );
 *
 * // Use the channel
 * channel.subscribe({
 *   asyncEnd: (data) => {
 *     data.span?.end();
 *   }
 * });
 *
 * await channel.tracePromise(async () => {
 *   // Your async work - context is automatically propagated!
 * }, { op: 'fetch', key: 'user-123' });
 * ```
 */
export function tracingChannel<TData extends object = any>(
  channelNameOrInstance: string | TracingChannel<TData, TData>,
  transformStart: TracingChannelTransform<TData>,
): TracingChannel<WithSpan<TData>, WithSpan<TData>> {
  // Get or create the channel
  const channel =
    typeof channelNameOrInstance === 'string'
      ? nativeTracingChannel<WithSpan<TData>, WithSpan<TData>>(
          channelNameOrInstance,
        )
      : channelNameOrInstance;

  try {
    // Get OTel's internal AsyncLocalStorage
    const contextManager = (context as any)._getContextManager();

    if (!contextManager?._asyncLocalStorage) {
      debugLog('Could not access OpenTelemetry AsyncLocalStorage');
      debugLog('Context propagation will NOT work!');
      return channel;
    }

    const otelStorage = contextManager._asyncLocalStorage;
    debugLog('Found OpenTelemetry AsyncLocalStorage');

    // Bind the start channel with the transform
    // @ts-ignore - bindStore types don't account for AsyncLocalStorage of different type
    channel.start.bindStore(otelStorage, (data: WithSpan<TData>) => {
      debugLog('Creating span in bindStore transform');

      // Call the user's transform to create the span
      const span = transformStart(data);
      if (!isSpan(span)) {
        debugLog(
          `"transformStart" returned a non-span value, this may break child span relationship`,
        );
        // Return the current context without modification
        return context.active();
      }

      // Store the span on data so event handlers can access it
      data.span = span;

      // Wrap the span in a context and return it
      // This is what gets stored in AsyncLocalStorage
      const ctx = trace.setSpan(context.active(), span);

      debugLog('Returning context to AsyncLocalStorage');
      return ctx;
    });

    debugLog('OTel context bound to tracing channel');
  } catch (err) {
    debugLog('Error setting up OTel context binding:', err);
  }

  return channel;
}
