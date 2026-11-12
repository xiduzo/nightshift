import { expect, test } from "bun:test";
import { ATTR, RETIRED_USAGE_EVENT, USAGE_EVENT } from "@nightshift/semconv";

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

test("a retired event of an older build is accepted next to the event that replaced it", () => {
	const RUN_ID = attribute(USAGE_EVENT.runScored, "run.id");
	const SCORE = attribute(USAGE_EVENT.runScored, "score.name");
	const VALUE = attribute(USAGE_EVENT.runScored, "score.value");
	const USEFUL = attribute(RETIRED_USAGE_EVENT.pullRequestUseful, "useful");
	const UNKNOWN = ["night", "shift.pull_request.merged"].join("");
	const read = readLogs(
		logs([
			{
				name: RETIRED_USAGE_EVENT.pullRequestUseful,
				attributes: [
					{ key: RUN_ID, value: { stringValue: "0123456789abcdef" } },
					{ key: USEFUL, value: { boolValue: true } },
				],
			},
			{
				name: USAGE_EVENT.runScored,
				attributes: [
					{ key: RUN_ID, value: { stringValue: "0123456789abcdef" } },
					{ key: SCORE, value: { stringValue: "useful" } },
					{ key: VALUE, value: { doubleValue: 0 } },
				],
			},
			{
				name: USAGE_EVENT.runScored,
				attributes: [
					{ key: RUN_ID, value: { stringValue: "0123456789abcdef" } },
					{ key: SCORE, value: { stringValue: "a-flow-name" } },
					{ key: VALUE, value: { doubleValue: 1 } },
				],
			},
			{ name: UNKNOWN },
		]),
		{ country: null },
	);
	expect(read.rows.map((row) => row.eventName)).toEqual([
		RETIRED_USAGE_EVENT.pullRequestUseful,
		USAGE_EVENT.runScored,
	]);
	expect(read.rows[1]?.attributes).toEqual({
		[RUN_ID]: "0123456789abcdef",
		[SCORE]: "useful",
		[VALUE]: 0,
	});
	expect(read.refusals).toEqual([
		{ eventName: USAGE_EVENT.runScored, rule: INGEST_RULE.wrongType },
		{ eventName: UNKNOWN, rule: INGEST_RULE.unknownEvent },
	]);
});

test("a step end accepts where its climb landed and refuses free text on a ladder field", () => {
	const STEP = USAGE_EVENT.stepEnded;
	const step = {
		[attribute(STEP, "node.kind")]: { stringValue: "decision" },
		[attribute(STEP, "step.result")]: { stringValue: "pass" },
		[attribute(STEP, "step.visit")]: { intValue: "1" },
	};
	const KIND = attribute(STEP, "ladder.kind");
	const RUNG = attribute(STEP, "ladder.rung");
	const TRIES = attribute(STEP, "ladder.tries");
	const UNSURE = attribute(STEP, "ladder.unsure");
	const COST = attribute(STEP, "ladder.cost_usd");
	const fields = (extra: Record<string, Record<string, unknown>>) =>
		Object.entries({ ...step, ...extra }).map(([key, value]) => ({
			key,
			value,
		}));
	const read = readLogs(
		logs([
			// An older build: no ladder fields.
			{ name: STEP, attributes: fields({}) },
			{
				name: STEP,
				attributes: fields({
					[KIND]: { stringValue: "choice" },
					[RUNG]: { stringValue: "later" },
					[TRIES]: { intValue: "2" },
					[UNSURE]: { boolValue: true },
					[COST]: { doubleValue: 0.03 },
				}),
			},
			// The name of a tier is the person's own text: never a rung.
			{
				name: STEP,
				attributes: fields({
					[KIND]: { stringValue: "work" },
					[RUNG]: { stringValue: "Strong agent" },
				}),
			},
			// The name of a tier goes to monitoring only, never to usage.
			{
				name: STEP,
				attributes: fields({
					[KIND]: { stringValue: "work" },
					[RUNG]: { stringValue: "first" },
					[ATTR.ladderTier]: { stringValue: "Strong agent" },
				}),
			},
		]),
		{ country: null },
	);
	expect(read.rows).toHaveLength(2);
	expect(read.rows[0]?.attributes).not.toHaveProperty(RUNG);
	expect(read.rows[1]?.attributes).toMatchObject({
		[KIND]: "choice",
		[RUNG]: "later",
		[TRIES]: 2,
		[UNSURE]: true,
		[COST]: 0.03,
	});
	expect(read.refusals).toEqual([
		{ eventName: STEP, rule: INGEST_RULE.wrongType },
		{ eventName: STEP, rule: INGEST_RULE.unknownAttribute },
	]);
	expect(JSON.stringify(read)).not.toContain("Strong agent");
});
