import type { TelemetryProtocol } from "@nightshift/engine/device-config";
import {
	type Attributes,
	ROOT_CONTEXT,
	SpanStatusCode,
	TraceFlags,
	trace,
} from "@opentelemetry/api";
import { OTLPMetricExporter as JsonMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPMetricExporter as ProtoMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter as JsonTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as ProtoTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	MeterProvider,
	PeriodicExportingMetricReader,
	type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import {
	BatchSpanProcessor,
	type IdGenerator,
	RandomIdGenerator,
	type SpanExporter,
	TracerProvider,
} from "@opentelemetry/sdk-trace";

import { ATTR, SCOPE_NAME, SERVICE_NAME } from "../conventions";

/**
 * The tracer and meter providers of one export: OTLP over HTTP to one
 * endpoint, with its headers. Hand-written spans only (Bun has no working
 * auto-instrumentation), so nothing is registered globally: the export is
 * these two providers and nothing else, and turning it off shuts them
 * down. No context manager is needed: every span names its parent.
 */

/** Where the export sends its spans and metrics. */
export type ExportTarget = {
	/** The OTLP endpoint, without `/v1/traces`: `http://localhost:4318`. */
	endpoint: string;
	/** How the export talks OTLP over HTTP: the setting's protocol. */
	protocol: TelemetryProtocol;
	/** Sent with every request: an API key, a tenant. */
	headers: Readonly<Record<string, string>>;
};

/**
 * The ids of the next span: `writeSpan` sets them just before it starts a
 * span, so every span of a run has the ids any process can work out
 * (`conventions/ids.ts`). Unset: random, as the SDK's own.
 */
class NextIds implements IdGenerator {
	traceId: string | null = null;
	spanId: string | null = null;
	readonly #random = new RandomIdGenerator();
	generateTraceId(): string {
		return this.traceId ?? this.#random.generateTraceId();
	}
	generateSpanId(): string {
		return this.spanId ?? this.#random.generateSpanId();
	}
}

/** A finished span with the ids any process can work out: its trace, its own, its parent's. */
export type SpanInput = {
	name: string;
	traceId: string;
	spanId: string;
	/** Null: the trace's root. Else a parent no process holds, named by its id. */
	parentSpanId: string | null;
	from: number;
	to: number;
	attributes: Attributes;
	/** Marks the span failed, with this message. */
	error?: string | null;
};

/** One running export. */
export type RunningExport = {
	meterProvider: MeterProvider;
	/** Writes one finished span with the ids it is given. */
	writeSpan(span: SpanInput): void;
	/** Sends what waits. */
	flush(): Promise<void>;
	/** Sends what waits and stops. Never throws. */
	shutdown(): Promise<void>;
};

/** Where an export's spans and points go: OTLP, or a test's in-memory exporters. */
export type ExportSinks = { spans: SpanExporter; metrics: PushMetricExporter };

/** The OTLP exporters of a target. */
export function otlpSinks(target: ExportTarget): ExportSinks {
	const base = target.endpoint.replace(/\/+$/, "");
	const headers = { ...target.headers };
	const traces = { url: `${base}/v1/traces`, headers };
	const metrics = { url: `${base}/v1/metrics`, headers };
	return target.protocol === "http/json"
		? {
				spans: new JsonTraceExporter(traces),
				metrics: new JsonMetricExporter(metrics),
			}
		: {
				spans: new ProtoTraceExporter(traces),
				metrics: new ProtoMetricExporter(metrics),
			};
}

/**
 * Starts the providers over `sinks`. `metricIntervalMs`: how often the
 * metrics go out (default 60 s, the SDK's).
 */
export function startExport(
	sinks: ExportSinks,
	options: { deviceId: string; metricIntervalMs?: number },
): RunningExport {
	const resource = resourceFromAttributes({
		[ATTR.serviceName]: SERVICE_NAME,
		[ATTR.serviceInstance]: options.deviceId,
		[ATTR.deviceId]: options.deviceId,
	});
	const ids = new NextIds();
	const tracerProvider = new TracerProvider({
		resource,
		idGenerator: ids,
		spanProcessors: [new BatchSpanProcessor({ exporter: sinks.spans })],
	});
	const meterProvider = new MeterProvider({
		resource,
		readers: [
			new PeriodicExportingMetricReader({
				exporter: sinks.metrics,
				exportIntervalMillis: options.metricIntervalMs ?? 60_000,
			}),
		],
	});
	const tracer = tracerProvider.getTracer(SCOPE_NAME);
	return {
		meterProvider,
		writeSpan(span) {
			ids.traceId = span.traceId;
			ids.spanId = span.spanId;
			try {
				const context =
					span.parentSpanId === null
						? ROOT_CONTEXT
						: trace.setSpanContext(ROOT_CONTEXT, {
								traceId: span.traceId,
								spanId: span.parentSpanId,
								traceFlags: TraceFlags.SAMPLED,
								isRemote: true,
							});
				const started = tracer.startSpan(
					span.name,
					{ startTime: span.from, attributes: span.attributes },
					context,
				);
				if (span.error) {
					started.setStatus({
						code: SpanStatusCode.ERROR,
						message: span.error,
					});
				}
				started.end(Math.max(span.to, span.from));
			} finally {
				ids.traceId = null;
				ids.spanId = null;
			}
		},
		async flush() {
			await Promise.all([
				tracerProvider.forceFlush(),
				meterProvider.forceFlush(),
			]);
		},
		async shutdown() {
			await Promise.allSettled([
				tracerProvider.shutdown(),
				meterProvider.shutdown(),
			]);
		},
	};
}

/** The meter of an export, under Night Shift's scope. */
export const meterOf = (running: RunningExport) =>
	running.meterProvider.getMeter(SCOPE_NAME);
