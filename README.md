# otel-tracing-channel

A thin wrapper around Node.js's `tracingChannel` that properly propagates OpenTelemetry context.

## The Problem

Node.js's native `tracingChannel` loses OpenTelemetry context between the `start` event and the callback execution. This breaks distributed tracing when using diagnostic channels.

## The Solution

This package fixes context propagation by:

- Capturing the OpenTelemetry context from spans returned in start handlers
- Running callbacks within the captured context
- Maintaining compatibility with Node.js's native `TracingChannel` API with minor improvements

## Installation

```bash
npm install otel-tracing-channel
```

## Usage

```ts
import { tracingChannel } from 'otel-tracing-channel';
import { trace } from '@opentelemetry/api';

const channel = tracingChannel('my-operation');

// Subscribe to events - all handlers are optional
channel.subscribe({
  start(context) {
    // Create and return a span - context will be automatically propagated
    const span = trace.getTracer('my-app').startSpan('my-operation');

    return span; // 🔥 Context propagation happens automatically
  },
  end(context) {
    // Span context is preserved here!
  },
  error(context) {
    // Handle errors
  },
});

// Use it
await channel.tracePromise(async () => {
  // Your async work - OpenTelemetry context is properly propagated!
  await doSomething();
}, {});
```

## API

### `tracingChannel<ContextType>(name: string)`

Creates a new tracing channel with proper context propagation.

### `channel.subscribe(subscribers)`

Subscribe to channel events. All handlers are optional:

- `start(context)` - Called when operation starts. Return a span to propagate it to other callbacks.
- `asyncStart(context)` - Called for async operations.
- `asyncEnd(context)` - Called when async operation ends.
- `end(context)` - Called when operation ends.
- `error(context)` - Called on errors.

### `channel.tracePromise(fn, context, ...args)`

Execute an async function with tracing. Context is properly propagated.

### `channel.traceSync(fn, context, ...args)`

Execute a sync function with tracing.

### `channel.bindStore(storage)` / `channel.unbindStore(storage)`

New API: binds/unbinds AsyncLocalStorage instances on all sub-channels.

## Debug Logging

Enable debug logs to see what's happening:

```typescript
import { setDebugFlag } from 'otel-tracing-channel';

setDebugFlag(true); // Enable debug logs
setDebugFlag(false); // Disable debug logs
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
