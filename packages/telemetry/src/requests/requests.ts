import {
	context,
	ProxyTracerProvider,
	type TracerProvider,
	trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ORPCInstrumentation } from "@orpc/otel";

/**
 * Spans for the API requests of this computer while the export is on:
 * oRPC's own instrumentation (`@orpc/otel`), a maintained library, with
 * a span per request it handles (`POST /rpc/...`, `handler`,
 * `call_procedure`, the input checks and each middleware) and per request
 * it sends to a Host (`send_request`).
 *
 * oRPC reads the global tracer provider and context, so while the export
 * is on, its tracer provider is the global one and an
 * `AsyncLocalStorageContextManager` nests the spans of one request (Bun's
 * `AsyncHooksContextManager` loses them across awaits). The run spans do
 * not use either: each names its parent itself. Propagation stays off: no
 * propagator is registered, so a caller's `traceparent` starts no trace
 * here and a request to a Host carries none.
 *
 * The global provider gives oRPC's tracer only. Other libraries that use
 * the OpenTelemetry API (Better Auth traces each session lookup) get one
 * that records nothing: the export sends what its docs list, no more.
 */

/** oRPC's instrumentation scope: the one tracer the global provider gives. */
const ORPC_SCOPE = "@orpc/otel";

/** A provider of `provider`'s tracer for oRPC only, and of a no-op one for any other. */
function orpcOnly(provider: TracerProvider): TracerProvider {
	// Without a delegate it gives tracers that record nothing.
	const none = new ProxyTracerProvider();
	return {
		getTracer: (name, version, options) =>
			name === ORPC_SCOPE
				? provider.getTracer(name, version, options)
				: none.getTracer(name, version, options),
	};
}

/** Turns request spans on, through `provider`. Returns what turns them off. */
export function traceRequests(provider: TracerProvider): () => void {
	// One export at a time owns the globals: the last one to start.
	trace.disable();
	context.disable();
	trace.setGlobalTracerProvider(orpcOnly(provider));
	context.setGlobalContextManager(
		new AsyncLocalStorageContextManager().enable(),
	);
	const instrumentation = new ORPCInstrumentation({ enabled: false });
	instrumentation.enable();
	let on = true;
	return () => {
		if (!on) return;
		on = false;
		instrumentation.disable();
		trace.disable();
		context.disable();
	};
}
