import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	LoggerProvider,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";

import { ATTR, SERVICE_NAME } from "../conventions";
import { hostArch, osType } from "../otlp";
import type { WaitingEvent } from "./outbox";

/** One request stays under this, leaving room for the OTLP envelope. */
export const USAGE_MAX_BODY = 200_000;

const EVENT_NAME = "event.name";

export type UsageTransport = {
	send(events: WaitingEvent[], installId: string): Promise<void>;
};

/** The ingest of the Night Shift team. Released builds send here. */
export const DEFAULT_USAGE_ENDPOINT = "https://ingest.xiduzo.com/nightshift";

/**
 * Where usage goes. A non-empty NIGHTSHIFT_USAGE_ENDPOINT wins. Otherwise a
 * released build (NIGHTSHIFT_VERSION is set) sends to the team ingest, and a
 * run from source (no version) sends nothing. NIGHTSHIFT_USAGE=off and the
 * other locks still stop every send.
 */
export function usageEndpoint(
	env: Record<string, string | undefined> = process.env,
): string {
	const chosen = env.NIGHTSHIFT_USAGE_ENDPOINT?.trim() ?? "";
	if (chosen !== "") return chosen;
	return env.NIGHTSHIFT_VERSION?.trim() ? DEFAULT_USAGE_ENDPOINT : "";
}

/** The logs URL. A base without `/v1/logs` gets that path. */
export function usageLogsUrl(endpoint: string): string {
	const base = endpoint.trim().replace(/\/+$/, "");
	return base.endsWith("/v1/logs") ? base : `${base}/v1/logs`;
}

/**
 * OTLP/HTTP JSON to `endpoint`. The resource is the usage export's only:
 * the install id, never the Device id.
 */
export function otlpUsageTransport(endpoint: string): UsageTransport {
	return {
		async send(events, installId) {
			const version = process.env.NIGHTSHIFT_VERSION?.trim() || "dev";
			const provider = new LoggerProvider({
				resource: resourceFromAttributes({
					[ATTR.serviceName]: SERVICE_NAME,
					[ATTR.serviceVersion]: version,
					[ATTR.osType]: osType(),
					[ATTR.hostArch]: hostArch(),
					[ATTR.serviceInstance]: installId,
				}),
				processors: [
					new SimpleLogRecordProcessor({
						exporter: new OTLPLogExporter({ url: usageLogsUrl(endpoint) }),
					}),
				],
			});
			const logger = provider.getLogger(SERVICE_NAME);
			for (const item of events) {
				logger.emit({
					eventName:
						typeof item.event.name === "string" ? item.event.name : undefined,
					timestamp: item.at,
					severityNumber: SeverityNumber.INFO,
					attributes: attributesOf(item.event),
				});
			}
			await provider.forceFlush();
			await provider.shutdown();
		},
	};
}

function attributesOf(
	event: Record<string, unknown>,
): Record<string, string | number | boolean | string[]> {
	const attributes: Record<string, string | number | boolean | string[]> = {};
	if (typeof event.name === "string") attributes[EVENT_NAME] = event.name;
	for (const [key, value] of Object.entries(event)) {
		if (key === "name") continue;
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			attributes[key] = value;
		} else if (
			Array.isArray(value) &&
			value.every((item) => typeof item === "string")
		) {
			attributes[key] = value;
		}
	}
	return attributes;
}

/** Groups waiting events so each request's JSON stays under `maxBody`. */
export function chunkEvents(
	events: readonly WaitingEvent[],
	maxBody = USAGE_MAX_BODY,
): WaitingEvent[][] {
	const chunks: WaitingEvent[][] = [];
	let batch: WaitingEvent[] = [];
	let size = 2;
	for (const event of events) {
		const next = JSON.stringify(event.event).length + 1;
		if (batch.length > 0 && size + next > maxBody) {
			chunks.push(batch);
			batch = [];
			size = 2;
		}
		batch.push(event);
		size += next;
	}
	if (batch.length > 0) chunks.push(batch);
	return chunks;
}
