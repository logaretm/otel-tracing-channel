import { context } from '@opentelemetry/api';
import type { TracingChannel } from './tracingChannel';
import { debugLog } from './utils';

export function prepChannel(channel: TracingChannel<any>) {
  try {
    const contextManager = (context as any)._getContextManager();
    if (contextManager?._asyncLocalStorage) {
      debugLog(
        '✅ Binding OpenTelemetry AsyncLocalStorage to unstorage channel',
      );
      channel.bindStore(contextManager._asyncLocalStorage);

      return channel;
    }

    debugLog('⚠️  Could not access OpenTelemetry AsyncLocalStorage');
  } catch (err) {
    debugLog('⚠️  Error accessing context manager:', err);
  }

  return channel;
}
