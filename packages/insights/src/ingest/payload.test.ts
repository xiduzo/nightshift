import { expect, test } from "bun:test";
import { ATTR, USAGE_EVENT } from "@nightshift/semconv";

import { attribute } from "../schema/keys";
import { readLogs } from "./payload";
import { INGEST_RULE } from "./rules";

const TIME = "1700000000000000000";
const ENTRY = attribute(USAGE_EVENT.installStarted, "install.entry");
const HOST = attribute(USAGE_EVENT.installStarted, "install.host");

function logs(
	records: {
		name: string;
		attributes?: { key: string; value: Record<string, unknown> }[];
	}[],
) {
	return {
		resourceLogs: [
			{
				resource: {
					attributes: [
						{ key: ATTR.serviceInstance, value: { stringValue: "install-1" } },
						{ key: ATTR.serviceVersion, value: { stringValue: "1.2.3" } },
						{ key: ATTR.osType, value: { stringValue: "darwin" } },
						{ key: ATTR.hostArch, value: { stringValue: "arm64" } },
					],
				},
				scopeLogs: [
					{
						logRecords: records.map((record) => ({
							timeUnixNano: TIME,
							attributes: [
								{ key: "event.name", value: { stringValue: record.name } },
								...(record.attributes ?? []),
							],
						})),
					},
				],
			},
		],
	};
}

test("a known event is accepted and an unknown attribute or event is refused", () => {
	const read = readLogs(
		logs([
			{ name: USAGE_EVENT.scheduleFired },
			{
				name: USAGE_EVENT.scheduleFired,
				attributes: [{ key: "spare", value: { stringValue: "secret-text" } }],
			},
			{ name: "not-listed" },
			{
				name: USAGE_EVENT.installStarted,
				attributes: [
					{ key: ENTRY, value: { stringValue: "desktop" } },
					{ key: HOST, value: { stringValue: "nope" } },
				],
			},
		]),
		{ country: "nl" },
	);

	expect(read.rows).toHaveLength(1);
	expect(read.refused).toBe(3);
	expect(read.rows[0]).toMatchObject({
		eventName: USAGE_EVENT.scheduleFired,
		installId: "install-1",
		serviceVersion: "1.2.3",
		osType: "darwin",
		hostArch: "arm64",
		country: "NL",
		attributes: {},
	});
	expect(read.refusals).toEqual([
		{
			eventName: USAGE_EVENT.scheduleFired,
			rule: INGEST_RULE.unknownAttribute,
		},
		{ eventName: "not-listed", rule: INGEST_RULE.unknownEvent },
		{ eventName: USAGE_EVENT.installStarted, rule: INGEST_RULE.wrongType },
	]);
	expect(JSON.stringify(read.refusals)).not.toContain("secret-text");
	expect(JSON.stringify(read.refusals)).not.toContain("nope");
});

test("a country that is not a code is stored as null", () => {
	const read = readLogs(logs([{ name: USAGE_EVENT.scheduleFired }]), {
		country: "Netherlands",
	});
	expect(read.rows[0]?.country).toBeNull();
});

test("a body that is not JSON or not logs fails without the body", () => {
	expect(() => readLogs("{", { country: null })).toThrow(
		"Logs payload is not JSON.",
	);
	expect(() => readLogs({ resourceSpans: [] }, { country: null })).toThrow(
		"Logs payload is not an OTLP logs request.",
	);
});
