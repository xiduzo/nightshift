import { describe, expect, test } from "bun:test";

import { ATTR, METRIC, OPERATION, SPAN } from "../conventions";
import { assertConforms } from "./index";

/**
 * A span or metric the registry does not allow fails the check.
 * The run export is checked in wire.test.ts, on the in-memory engine.
 */

describe("the registry check", () => {
	test("fails a missing provider, a missing workflow name and a missing error.type", () => {
		expect(() =>
			assertConforms({
				spans: [
					{
						name: `${OPERATION.agent} build`,
						failed: false,
						attributes: {
							[ATTR.agentName]: "build",
							[ATTR.operation]: OPERATION.agent,
						},
					},
				],
				metrics: [],
			}),
		).toThrow(ATTR.provider);

		expect(() =>
			assertConforms({
				spans: [
					{
						name: `${OPERATION.workflow} nightly`,
						failed: false,
						attributes: { [ATTR.operation]: OPERATION.workflow },
					},
				],
				metrics: [],
			}),
		).toThrow(ATTR.workflowName);

		expect(() =>
			assertConforms({
				spans: [
					{
						name: `${OPERATION.workflow} nightly`,
						failed: true,
						attributes: {
							[ATTR.operation]: OPERATION.workflow,
							[ATTR.workflowName]: "nightly",
						},
					},
				],
				metrics: [],
			}),
		).toThrow(ATTR.errorType);
	});

	test("fails a name, a unit and a type the registry does not define", () => {
		expect(() =>
			assertConforms({
				spans: [{ name: "decision ship", failed: false, attributes: {} }],
				metrics: [],
			}),
		).toThrow("decision ship");

		expect(() =>
			assertConforms({
				spans: [],
				metrics: [
					{
						name: "made.up",
						unit: "1",
						instrument: "counter",
						points: [],
					},
				],
			}),
		).toThrow("made.up");

		expect(() =>
			assertConforms({
				spans: [],
				metrics: [
					{
						name: METRIC.stepDuration.name,
						unit: "ms",
						instrument: "histogram",
						points: [],
					},
				],
			}),
		).toThrow("ms");

		expect(() =>
			assertConforms({
				spans: [
					{
						name: `${SPAN.step} check`,
						failed: false,
						attributes: {
							[ATTR.nodeId]: "check",
							[ATTR.nodeKind]: "command",
							[ATTR.visit]: "one",
						},
					},
				],
				metrics: [],
			}),
		).toThrow(ATTR.visit);
	});

	test("fails a landing without its ladder and a flow metric without its name", () => {
		expect(() =>
			assertConforms({
				spans: [],
				metrics: [
					{
						name: METRIC.ladderRung.name,
						unit: METRIC.ladderRung.unit,
						instrument: "counter",
						points: [{ attributes: { [ATTR.ladderRung]: "first" } }],
					},
				],
			}),
		).toThrow(ATTR.ladderKind);

		expect(() =>
			assertConforms({
				spans: [],
				metrics: [
					{
						name: METRIC.flowMetric.name,
						unit: METRIC.flowMetric.unit,
						instrument: "histogram",
						points: [{ attributes: {} }],
					},
				],
			}),
		).toThrow(ATTR.flowMetricName);

		expect(() =>
			assertConforms({
				spans: [],
				metrics: [
					{
						name: METRIC.ladderRung.name,
						unit: METRIC.ladderRung.unit,
						instrument: "counter",
						points: [
							{
								attributes: {
									[ATTR.ladderKind]: "choice",
									[ATTR.ladderRung]: "later",
									[ATTR.ladderUnsure]: "yes",
								},
							},
						],
					},
				],
			}),
		).toThrow(ATTR.ladderUnsure);
	});
});
