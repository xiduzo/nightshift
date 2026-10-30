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

/** How the export talks OTLP over HTTP. */
export type OtlpProtocol = "http/protobuf" | "http/json";

/** Where the export sends its spans and metrics. */
export type ExportTarget = {
	/** The OTLP endpoint, without `/v1/traces`: `http://localhost:4318`. */
	endpoint: string;
	protocol: OtlpProtocol;
	/** Sent with every request: an API key, a tenant. */
	headers: Readonly<Record<string, string>>;
};

/**
 * The ids of the next span: the projection sets them just before it
 * starts a span, so every span of a run has the ids any process can work
 * out (`conventions/ids.ts`). Unset: random, as the SDK's own.
 */
export class NextIds implements IdGenerator {
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

/** One running export. */
export type RunningExport = {
	tracerProvider: TracerProvider;
	meterProvider: MeterProvider;
	ids: NextIds;
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
	return {
		tracerProvider,
		meterProvider,
		ids,
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

/** The tracer of an export, under Night Shift's scope. */
export const tracerOf = (running: RunningExport) =>
	running.tracerProvider.getTracer(SCOPE_NAME);

/** The meter of an export, under Night Shift's scope. */
export const meterOf = (running: RunningExport) =>
	running.meterProvider.getMeter(SCOPE_NAME);
