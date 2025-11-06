# otel-tracing-channel

A lightweight wrapper around Node.js's `tracingChannel` that properly propagates OpenTelemetry context.

## The Problem

Node.js's native `tracingChannel` doesn't automatically propagate OpenTelemetry context between the `start` event and the callback execution. This breaks distributed tracing when using diagnostic channels.

While creating spans works fine, the parent-child relationship between spans is broken - traces get created as siblings rather than children, which can paint a misleading picture for end users.

## The Solution

This package solves the problem by binding OpenTelemetry's internal `AsyncLocalStorage` to the tracing channel's `start` event using `bindStore`. This ensures that:

- The OpenTelemetry context is automatically propagated throughout the traced operation
- Parent-child span relationships are maintained correctly
- The solution is minimal and non-intrusive

## Installation

```bash
npm install otel-tracing-channel
```

## Usage

### Basic Example

```typescript
import { tracingChannel } from 'otel-tracing-channel';
import { trace } from '@opentelemetry/api';

// Create a channel with a transform function that creates your span
const channel = tracingChannel(
  'my-operation',
  (data) => {
    // Create and return a span from the channel data
    const span = trace.getTracer('my-app').startSpan('my-operation', {
      attributes: {
        userId: data.userId,
        // ... other attributes from data
      }
    });
    return span;
  }
);

// Subscribe to events to handle span lifecycle
channel.subscribe({
  asyncEnd(data) {
    // The span is available on data.span
    data.span?.end();
  },
  error(data) {
    data.span?.recordException(data.error);
    data.span?.end();
  }
});

// Use it - context is automatically propagated!
await channel.tracePromise(async () => {
  // Your async work - OpenTelemetry context is properly propagated
  await doSomething();
}, { userId: '123' });
```

### With Sentry

```typescript
import { tracingChannel } from 'otel-tracing-channel';
import * as Sentry from '@sentry/node';

const channel = tracingChannel(
  'database:query',
  (data) => {
    return Sentry.startSpanManual(
      {
        name: 'db.query',
        op: 'db',
        attributes: {
          'db.statement': data.query,
          'db.system': 'postgresql'
        }
      },
      (span) => span
    );
  }
);

channel.subscribe({
  asyncEnd: (data) => {
    data.span?.end();
  }
});

// Execute with automatic context propagation
await channel.tracePromise(
  async () => {
    return await db.query('SELECT * FROM users');
  },
  { query: 'SELECT * FROM users' }
);
```

### Wrapping Existing Channels

You can also wrap existing `TracingChannel` instances:

```typescript
import { tracingChannel as nativeTracingChannel } from 'node:diagnostics_channel';
import { tracingChannel } from 'otel-tracing-channel';

const existingChannel = nativeTracingChannel('my-channel');
const wrappedChannel = tracingChannel(
  existingChannel,
  (data) => createMySpan(data)
);
```

## API

### `tracingChannel<TData>(channelNameOrInstance, transformStart)`

Creates or wraps a tracing channel with OpenTelemetry context propagation.

**Parameters:**
- `channelNameOrInstance`: Either a string channel name or an existing `TracingChannel` instance
- `transformStart`: A function that receives the channel data and returns an OpenTelemetry `Span`

**Returns:** A `TracingChannel` instance with OTel context binding

The `transformStart` function is called during the `start` event and:
- Receives the channel data as its parameter
- Should create and return an OpenTelemetry `Span`
- The returned span is automatically stored on `data.span` for access in event handlers
- The span's context is automatically propagated throughout the traced operation

### `TracingChannelTransform<TData>`

Type definition for the transform function:

```typescript
type TracingChannelTransform<TData = any> = (data: TData) => Span;
```

### `channel.subscribe(subscribers)`

Subscribe to channel events. All handlers are optional:

- `start(data)` - Called when operation starts
- `asyncStart(data)` - Called for async operations
- `asyncEnd(data)` - Called when async operation ends (good place to end spans)
- `end(data)` - Called when operation ends
- `error(data)` - Called on errors (access error via `data.error`)

The span created in `transformStart` is available as `data.span` in all handlers.

### `channel.tracePromise(fn, context, ...args)`

Execute an async function with tracing. Context is properly propagated.

### `channel.traceSync(fn, context, ...args)`

Execute a sync function with tracing. Context is properly propagated.

## Debug Logging

Enable debug logs to see what's happening under the hood:

```typescript
import { setDebugFlag } from 'otel-tracing-channel';

setDebugFlag(true); // Enable debug logs
setDebugFlag(false); // Disable debug logs
```

Debug logs will show:
- Whether OpenTelemetry AsyncLocalStorage was found
- When spans are created in the transform
- When context is stored in AsyncLocalStorage

## How It Works

Under the hood, this package:

1. Accesses OpenTelemetry's internal `AsyncLocalStorage` instance via `context._getContextManager()`
2. Binds it to the channel's `start` event using `bindStore`
3. In the transform function:
   - Calls your `transformStart` to create the span
   - Stores the span on `data.span` for handler access
   - Wraps the span in an OTel context
   - Returns the context to be stored in `AsyncLocalStorage`

This ensures the OpenTelemetry context (and your span) is active throughout the entire traced operation.

## Graceful Degradation

If OpenTelemetry context is not available (e.g., no SDK initialized), the library:
- Logs a debug message (if debug logging is enabled)
- Returns the channel without OTel binding
- The channel still works normally, just without automatic context propagation

## TypeScript Support

Full TypeScript support with generics for channel data:

```typescript
interface QueryData {
  query: string;
  params: any[];
}

const channel = tracingChannel<QueryData>(
  'db:query',
  (data) => {
    // data is typed as QueryData
    return createSpan(data.query, data.params);
  }
);
```

## Publishing

This package uses [npm Trusted Publishers](https://docs.npmjs.com/generating-provenance-statements#using-third-party-package-publishing-tools) with GitHub Actions. No npm tokens required!

**Version Options:**

- `as-is` - Publish current version in package.json (no auto-bump)
- `patch` - Bug fixes (0.1.0 → 0.1.1)
- `minor` - New features (0.1.0 → 0.2.0)
- `major` - Breaking changes (0.1.0 → 1.0.0)

You can manually edit `package.json` version and use `as-is`, or let the workflow bump it automatically.

## License

Apache-2.0
