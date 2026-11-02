import { ATTR, usageEventSchema } from "@nightshift/semconv";
import { asDate, type Instant } from "@nightshift/time";

import type { usageEvent } from "../schema";
import { INGEST_RULE, type IngestRefusal, type IngestRule } from "./rules";

const UNREADABLE = Object.freeze({ unreadable: true });

export type UsageEventRow = typeof usageEvent.$inferInsert;

export type ReadLogs = {
	rows: UsageEventRow[];
	refused: number;
	refusals: IngestRefusal[];
};

type ResourceFields = {
	installId: string | null;
	serviceVersion: string | null;
	osType: string | null;
	hostArch: string | null;
};

/** Reads an OTLP/HTTP JSON logs body. Does not store it and does not log it. */
export function readLogs(
	body: unknown,
	options: { country: string | null },
): ReadLogs {
	const payload = jsonBody(body);
	if (!isRecord(payload) || !Array.isArray(payload.resourceLogs)) {
		throw new Error("Logs payload is not an OTLP logs request.");
	}
	const country = countryOf(options.country);
	const rows: UsageEventRow[] = [];
	const refusals: IngestRefusal[] = [];
	let refused = 0;
	for (const resourceLog of payload.resourceLogs) {
		if (!isRecord(resourceLog)) continue;
		const resource = resourceOf(resourceLog.resource);
		const scopeLogs = Array.isArray(resourceLog.scopeLogs)
			? resourceLog.scopeLogs
			: [];
		for (const scopeLog of scopeLogs) {
			if (!isRecord(scopeLog) || !Array.isArray(scopeLog.logRecords)) continue;
			for (const record of scopeLog.logRecords) {
				const decision = decide(record, resource, country);
				if (decision.row) rows.push(decision.row);
				else {
					refused += 1;
					refusals.push(...decision.refusals);
				}
			}
		}
	}
	return { rows, refused, refusals };
}

function decide(
	record: unknown,
	resource: ResourceFields,
	country: string | null,
): { row: UsageEventRow | null; refusals: IngestRefusal[] } {
	if (!isRecord(record)) {
		return { row: null, refusals: [refusal(null, INGEST_RULE.unknownEvent)] };
	}
	const attributesUnreadable =
		record.attributes !== undefined && !Array.isArray(record.attributes);
	const attributes = attributesUnreadable
		? new Map<string, unknown>()
		: attributeMap(record.attributes);
	const named = eventNameOf(attributes, record);
	attributes.delete("event.name");
	const rules = new Set<IngestRule>();
	if (attributesUnreadable || named.bad) rules.add(INGEST_RULE.wrongType);
	if (Object.hasOwn(Object.fromEntries(attributes), "name")) {
		rules.add(INGEST_RULE.unknownAttribute);
		attributes.delete("name");
	}
	const eventName = named.name;
	if (!eventName || !Object.hasOwn(usageEventSchema, eventName)) {
		rules.add(INGEST_RULE.unknownEvent);
		return { row: null, refusals: refusalsOf(eventName, rules) };
	}
	const schema = usageEventSchema[eventName as keyof typeof usageEventSchema];
	const parsed = schema.safeParse({
		...Object.fromEntries(attributes),
		name: eventName,
	});
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			rules.add(
				issue.code === "unrecognized_keys"
					? INGEST_RULE.unknownAttribute
					: INGEST_RULE.wrongType,
			);
		}
	}
	const eventMs =
		unixNano(record.timeUnixNano) ?? unixNano(record.observedTimeUnixNano);
	if (!eventMs) rules.add(INGEST_RULE.wrongType);
	if (rules.size > 0 || !parsed.success || !eventMs) {
		return { row: null, refusals: refusalsOf(eventName, rules) };
	}
	const stored: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(parsed.data)) {
		if (key === "name") continue;
		stored[key] = value;
	}
	return {
		row: {
			eventName,
			installId: resource.installId,
			eventTime: asDate(eventMs),
			serviceVersion: resource.serviceVersion,
			osType: resource.osType,
			hostArch: resource.hostArch,
			country,
			attributes: stored,
		},
		refusals: [],
	};
}

function eventNameOf(
	attributes: Map<string, unknown>,
	record: Record<string, unknown>,
): { name: string | null; bad: boolean } {
	if (attributes.has("event.name")) {
		const value = attributes.get("event.name");
		if (typeof value === "string" && value.trim() !== "") {
			return { name: value.trim(), bad: false };
		}
		return { name: null, bad: true };
	}
	if (typeof record.eventName === "string" && record.eventName.trim() !== "") {
		return { name: record.eventName.trim(), bad: false };
	}
	return { name: null, bad: false };
}

function refusalsOf(
	eventName: string | null,
	rules: Set<IngestRule>,
): IngestRefusal[] {
	const name = eventName ? eventToken(eventName) : null;
	const list = [...rules];
	if (list.length === 0) return [refusal(name, INGEST_RULE.unknownEvent)];
	return list.map((rule) => refusal(name, rule));
}

function refusal(eventName: string | null, rule: IngestRule): IngestRefusal {
	return { eventName, rule };
}

/** A short token. Anything else is free text and is not stored on a refusal. */
function eventToken(value: string): string | null {
	return /^[\w.-]{1,120}$/.test(value) ? value : null;
}

function jsonBody(body: unknown): unknown {
	if (typeof body !== "string") return body;
	try {
		return JSON.parse(body);
	} catch {
		throw new Error("Logs payload is not JSON.");
	}
}

function resourceOf(resource: unknown): ResourceFields {
	const attributes = isRecord(resource)
		? attributeMap(resource.attributes)
		: new Map();
	return {
		installId: shortString(attributes.get(ATTR.serviceInstance), 200),
		serviceVersion: shortString(attributes.get(ATTR.serviceVersion), 64),
		osType: shortString(attributes.get(ATTR.osType), 32),
		hostArch: shortString(attributes.get(ATTR.hostArch), 32),
	};
}

function attributeMap(value: unknown): Map<string, unknown> {
	const map = new Map<string, unknown>();
	if (!Array.isArray(value)) return map;
	for (const item of value) {
		if (!isRecord(item) || typeof item.key !== "string" || item.key === "")
			continue;
		map.set(item.key, decode(item.value));
	}
	return map;
}

function decode(value: unknown): unknown {
	if (!isRecord(value)) return UNREADABLE;
	if ("stringValue" in value) {
		return typeof value.stringValue === "string"
			? value.stringValue
			: UNREADABLE;
	}
	if ("boolValue" in value) {
		return typeof value.boolValue === "boolean" ? value.boolValue : UNREADABLE;
	}
	if ("intValue" in value) return numberOf(value.intValue);
	if ("doubleValue" in value) return numberOf(value.doubleValue);
	if ("arrayValue" in value) return decodeArray(value.arrayValue);
	return UNREADABLE;
}

function decodeArray(value: unknown): unknown {
	if (!isRecord(value) || !Array.isArray(value.values)) return UNREADABLE;
	return value.values.map((item) => decode(item));
}

function numberOf(value: unknown): unknown {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : UNREADABLE;
	}
	return UNREADABLE;
}

function unixNano(value: unknown): Instant | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const text = String(value).trim();
	if (!/^\d+$/.test(text)) return null;
	try {
		const ms = Number(BigInt(text) / 1_000_000n);
		if (!Number.isFinite(ms) || ms <= 0) return null;
		return ms;
	} catch {
		return null;
	}
}

function shortString(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (text === "" || text.length > max) return null;
	return text;
}

function countryOf(value: string | null): string | null {
	if (value == null) return null;
	const code = value.trim().toUpperCase();
	return /^[A-Z0-9]{2}$/.test(code) ? code : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
