# otel-tracing-channel

A thin wrapper around Node.js's `tracingChannel` that properly propagates OpenTelemetry context.

## The Problem

Node.js's native `tracingChannel` seems to lose the OpenTelemetry context between the `start` event and the callback execution. This breaks some aspects of distributed tracing when using diagnostic channels.

While creating spans is fine with the current API, the parent-child relationship between spans is broken and the traces/spans gets created as siblings rather than children which can paint a misleading picture about what is going on for end users.

I'm not sure if this is a bug in the runtime itself or could be a misunderstanding of the tracing channel purpose. But all I know is `tracePromise` and `traceSync` cannot be used to propagate the span context correctly throughout the execution.

I have built (vibed) a couple of minimal reproductions in https://github.com/logaretm/node-playground/tree/tracing-ch-spans one with plain OTEL and one with plain Node.js API.

## The Solution

I thought if this indeed a problem with tracing channel implementation then it could be fixed with a similar implementation. From my tests it was possible as long as you can get the initial async storage instance you want to propagate, for OTEL it's the active context storage.

Regardless if this is an issue or not, this package makes it possible for OTEL purposes to use tracing channels.

This package fixes context propagation by:

- Capturing the OpenTelemetry context from spans returned in start handlers
- Running callbacks within the captured context
- Maintaining compatibility with Node.js's native `TracingChannel` API with minor adjustments for flexibility

I tried to make this package as thin as possible to allow 3rd party libraries to use it if they want to have a safe OTEL propagation in tracing channels until we figure out what is going on there.

## Installation

```bash
npm install otel-tracing-channel
```

## Usage

The key part is to return an OTEL `Span` implementation in the `start` channel handler, once you do that it will be kept active throughout until the `asyncEnd` or `end` are called.

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
