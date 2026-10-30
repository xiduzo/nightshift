import { describe, expect, test } from "bun:test";
import type { LandedFact, RunTrace } from "@nightshift/engine";
import {
	AggregationTemporality,
	type DataPoint,
	type Histogram,
	InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import {
	InMemorySpanExporter,
	type ReadableSpan,
} from "@opentelemetry/sdk-trace";

import { runSpanIdOf, stepSpanIdOf, traceIdOf } from "./conventions";
import { createTelemetry, type TelemetrySettings } from "./wire";

/*
 * The export over in-memory exporters: what a run's facts give as spans
 * and metric points, the environment of a Claude Code session, the
 * headers kept like a secret, and nothing at all while the setting is off.
 * The run is shape only.
 */

/** Keeps what it got after a shutdown, so a test reads it after `stop`. */
class KeptSpans extends InMemorySpanExporter {
	override async shutdown() {}
}
class KeptMetrics extends InMemoryMetricExporter {
	override async shutdown() {}
}

const DEVICE = "mac";

/** A run of a flow: an Agent, a Gate that waited, a Call with a Wait inside, then it finished. */
function nightRun(): RunTrace {
	return {
		runId: "run-1",
		projectId: "p1",
		flowName: "nightly",
		trigger: "schedule",
		startedAt: 1_000,
		ends: [
			{
				seq: 40,
				openedAt: 1_000,
				at: 9_000,
				status: "finished",
				reason: null,
				first: true,
			},
		],
		costUsd: 0.75,
		costBasis: "billed",
		steps: [
			{
				id: "s-agent",
				nodeId: "build",
				nodeType: "agent",
				visit: 1,
				parentStepId: null,
				deviceId: DEVICE,
				startedAt: 1_100,
				ends: [
					{
						seq: 10,
						openedAt: 1_100,
						at: 3_100,
						outcome: "pass",
						error: null,
						costUsd: null,
						first: true,
					},
				],
				sessions: [
					{
						id: "x1",
						harness: "claude-code",
						model: "claude-sonnet",
						startedAt: 1_200,
						endedAt: 3_000,
						costUsd: 0.75,
						costBasis: "billed",
						tokens: { input: 900, output: 100, cacheRead: 400, cacheWrite: 0 },
					},
				],
				gateWaits: [],
				sleeps: [],
			},
			{
				id: "s-gate",
				nodeId: "ship",
				nodeType: "decision",
				visit: 1,
				parentStepId: null,
				deviceId: DEVICE,
				startedAt: 3_200,
				ends: [
					{
						seq: 20,
						openedAt: 3_200,
						at: 6_200,
						outcome: "yes",
						error: null,
						costUsd: null,
						first: true,
					},
				],
				sessions: [],
				gateWaits: [{ from: 3_200, to: 6_200 }],
				sleeps: [],
			},
			{
				id: "s-call",
				nodeId: "each",
				nodeType: "call",
				visit: 1,
				parentStepId: null,
				deviceId: DEVICE,
				startedAt: 6_300,
				ends: [
					{
						seq: 35,
						openedAt: 6_300,
						at: 8_900,
						outcome: "done",
						error: null,
						costUsd: null,
						first: true,
					},
				],
				sessions: [],
				gateWaits: [],
				sleeps: [],
			},
			{
				id: "s-wait",
				nodeId: "pause",
				nodeType: "wait",
				visit: 2,
				parentStepId: "s-call",
				deviceId: DEVICE,
				startedAt: 6_400,
				ends: [
					{
						seq: 30,
						openedAt: 6_400,
						at: 8_400,
						outcome: "done",
						error: null,
						costUsd: null,
						first: true,
					},
				],
				sessions: [],
				gateWaits: [],
				sleeps: [{ from: 6_500, to: 8_300, reason: "duration" }],
			},
		],
	};
}

const fact = (
	extra:
		| { kind: "step-ended"; stepId: string; seq: number }
		| { kind: "run-ended"; seq: number }
		| {
				kind: "scored";
				seq: number;
				score: "gate_decision" | "pr_merged";
				label: string | null;
		  },
): LandedFact => {
	const base = {
		spaceId: "space-1",
		runId: "run-1",
		changes: "summary" as const,
	};
	if (extra.kind === "run-ended") {
		return { ...base, seq: extra.seq, kind: "run-ended", status: "finished" };
	}
	if (extra.kind === "scored") {
		return {
			...base,
			seq: extra.seq,
			kind: "scored",
			stepId: null,
			score: extra.score,
			value: 1,
			label: extra.label,
		};
	}
	return { ...base, seq: extra.seq, kind: "step-ended", stepId: extra.stepId };
};

/** A telemetry over a fake engine and a value store in memory. */
function setup(initial: Partial<TelemetrySettings> = {}) {
	let listener: ((facts: readonly LandedFact[]) => void) | null = null;
	let scope: unknown = null;
	const settings: TelemetrySettings = {
		enabled: true,
		endpoint: "http://localhost:4318",
		protocol: "http/protobuf",
		...initial,
	};
	const values = new Map<string, string>();
	const spans = new KeptSpans();
	const metrics = new KeptMetrics(AggregationTemporality.CUMULATIVE);
	const targets: unknown[] = [];
	const run = nightRun();
	const telemetry = createTelemetry({
		engine: {
			onLandedFacts: (l, s) => {
				listener = l;
				scope = s;
				return () => {
					listener = null;
				};
			},
			runTrace: async (runId) => (runId === run.runId ? run : null),
		},
		deviceId: DEVICE,
		settings: () => settings,
		values: {
			get: async (name) => values.get(name) ?? null,
			set: async (name, value) => {
				values.set(name, value);
			},
			delete: async (name) => {
				values.delete(name);
			},
		},
		sinks: (target) => {
			targets.push(target);
			return { spans, metrics };
		},
	});
	return {
		telemetry,
		settings,
		values,
		targets,
		scope: () => scope,
		land: (facts: LandedFact[]) => listener?.(facts),
		spans: () => spans.getFinishedSpans(),
		points: () => {
			const byName = new Map<string, DataPoint<unknown>[]>();
			for (const resource of metrics.getMetrics()) {
				for (const scoped of resource.scopeMetrics) {
					for (const metric of scoped.metrics) {
						byName.set(metric.descriptor.name, metric.dataPoints);
					}
				}
			}
			return byName;
		},
	};
}

const LANDINGS: LandedFact[][] = [
	[fact({ kind: "step-ended", stepId: "s-agent", seq: 10 })],
	[fact({ kind: "step-ended", stepId: "s-gate", seq: 20 })],
	[fact({ kind: "step-ended", stepId: "s-wait", seq: 30 })],
	[fact({ kind: "step-ended", stepId: "s-call", seq: 35 })],
	[fact({ kind: "run-ended", seq: 40 })],
];

const byName = (spans: ReadableSpan[], name: string) => {
	const found = spans.find((s) => s.name === name);
	if (!found)
		throw new Error(`No span ${name}: ${spans.map((s) => s.name).join(", ")}`);
	return found;
};
const parentOf = (span: ReadableSpan) => span.parentSpanContext?.spanId ?? null;
const sum = (
	points: DataPoint<unknown>[] | undefined,
	match: Record<string, unknown> = {},
) =>
	(points ?? [])
		.filter((p) =>
			Object.entries(match).every(([k, v]) => p.attributes[k] === v),
		)
		.reduce((total, p) => total + (p.value as number), 0);

describe("the export to monitoring", () => {
	test("while the setting is off, nothing is made and nothing goes out", async () => {
		const h = setup({ enabled: false });
		await h.telemetry.refresh();
		for (const landing of LANDINGS) h.land(landing);
		await h.telemetry.stop();
		expect(h.telemetry.active()).toBe(false);
		expect(h.targets).toEqual([]);
		expect(h.spans()).toEqual([]);
		expect(
			h.telemetry.sessionEnv({
				harness: "claude-code",
				runId: "run-1",
				stepId: "s-agent",
			}),
		).toEqual({});
	});

	test("on without an endpoint, it stays off", async () => {
		const h = setup({ endpoint: "  " });
		await h.telemetry.refresh();
		expect(h.telemetry.active()).toBe(false);
		expect(h.targets).toEqual([]);
	});

	test("a run's facts give one trace: the run, its steps, a Gate's wait and a sleep", async () => {
		const h = setup();
		await h.telemetry.refresh();
		expect(h.scope()).toEqual({ only: DEVICE });
		for (const landing of LANDINGS) h.land(landing);
		await h.telemetry.stop();

		const spans = h.spans();
		expect(spans.map((s) => s.name).sort()).toEqual([
			"call each",
			"decision ship",
			"gate ship",
			"invoke_agent build",
			"invoke_workflow nightly",
			"wait duration",
			"wait pause",
		]);
		const traceId = traceIdOf("run-1");
		expect(new Set(spans.map((s) => s.spanContext().traceId))).toEqual(
			new Set([traceId]),
		);

		const run = byName(spans, "invoke_workflow nightly");
		expect(run.spanContext().spanId).toBe(runSpanIdOf("run-1"));
		expect(parentOf(run)).toBeNull();
		expect(run.attributes).toMatchObject({
			"nightshift.run.id": "run-1",
			"gen_ai.conversation.id": "run-1",
			"nightshift.project.id": "p1",
			"nightshift.flow.id": "nightly",
			"gen_ai.operation.name": "invoke_workflow",
			"nightshift.device.id": DEVICE,
			"nightshift.run.status": "finished",
			"nightshift.run.trigger": "schedule",
		});
		expect(run.startTime).toEqual([1, 0]);
		expect(run.endTime).toEqual([9, 0]);

		const agent = byName(spans, "invoke_agent build");
		expect(agent.spanContext().spanId).toBe(stepSpanIdOf("s-agent"));
		expect(parentOf(agent)).toBe(runSpanIdOf("run-1"));
		expect(agent.attributes).toMatchObject({
			"nightshift.step.id": "s-agent",
			"nightshift.node.kind": "agent",
			"nightshift.agent": "claude-code",
			"gen_ai.request.model": "claude-sonnet",
			"gen_ai.operation.name": "invoke_agent",
			"nightshift.step.outcome": "pass",
		});

		const gate = byName(spans, "gate ship");
		expect(parentOf(gate)).toBe(stepSpanIdOf("s-gate"));
		expect(gate.attributes["nightshift.gate.wait_ms"]).toBe(3_000);

		// A step inside a Call hangs under the Call's span, its sleep under it.
		const wait = byName(spans, "wait pause");
		expect(parentOf(wait)).toBe(stepSpanIdOf("s-call"));
		expect(parentOf(byName(spans, "wait duration"))).toBe(
			stepSpanIdOf("s-wait"),
		);
		expect(
			byName(spans, "wait duration").attributes["nightshift.wait.reason"],
		).toBe("duration");

		const points = h.points();
		expect(
			points
				.get("nightshift.run.outcome")
				?.map((p) => [p.attributes.end_reason, p.value]),
		).toEqual([["finished", 1]]);
		const runDuration = points.get("nightshift.run.duration")?.[0]
			?.value as Histogram;
		expect(runDuration.count).toBe(1);
		expect(runDuration.sum).toBe(8);
		expect(sum(points.get("nightshift.tokens"), { type: "input" })).toBe(900);
		expect(sum(points.get("nightshift.tokens"), { type: "output" })).toBe(100);
		expect(sum(points.get("nightshift.tokens"), { type: "cache_read" })).toBe(
			400,
		);
		expect(
			sum(points.get("nightshift.run.cost_usd"), { basis: "billed" }),
		).toBe(0.75);
		expect(
			sum(points.get("nightshift.retries"), { "nightshift.node.kind": "wait" }),
		).toBe(1);
		const gateWait = points.get("nightshift.gate.wait")?.[0]
			?.value as Histogram;
		expect(gateWait.sum).toBe(3);
		const steps = points.get("nightshift.step.duration") ?? [];
		expect(steps.reduce((n, p) => n + (p.value as Histogram).count, 0)).toBe(4);
		// No ids of one run or step on a metric point.
		for (const list of points.values()) {
			for (const point of list) {
				expect(point.attributes["nightshift.run.id"]).toBeUndefined();
				expect(point.attributes["nightshift.step.id"]).toBeUndefined();
			}
		}
	});

	test("a score counts, and a merged pull request counts as an outcome", async () => {
		const h = setup();
		await h.telemetry.refresh();
		h.land([
			fact({ kind: "scored", seq: 50, score: "gate_decision", label: "yes" }),
			fact({ kind: "scored", seq: 51, score: "pr_merged", label: null }),
		]);
		await h.telemetry.stop();
		const points = h.points();
		expect(
			sum(points.get("nightshift.score"), {
				"nightshift.score.name": "gate_decision",
				"nightshift.score.label": "yes",
			}),
		).toBe(1);
		expect(
			sum(points.get("nightshift.pr.outcome"), { outcome: "merged" }),
		).toBe(1);
	});

	test("a Claude Code session gets its telemetry under the step, with no content", async () => {
		const h = setup();
		await h.telemetry.headers.save(
			"Authorization=Bearer abc 123\nX-Scope-OrgID: night",
		);
		const env = h.telemetry.sessionEnv({
			harness: "claude-code",
			runId: "run-1",
			stepId: "s-agent",
		});
		expect(env).toMatchObject({
			CLAUDE_CODE_ENABLE_TELEMETRY: "1",
			OTEL_METRICS_EXPORTER: "otlp",
			OTEL_LOGS_EXPORTER: "otlp",
			OTEL_TRACES_EXPORTER: "otlp",
			OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
			OTEL_EXPORTER_OTLP_HEADERS:
				"Authorization=Bearer%20abc%20123,X-Scope-OrgID=night",
			OTEL_RESOURCE_ATTRIBUTES:
				"nightshift.run.id=run-1,nightshift.step.id=s-agent,nightshift.device.id=mac",
			TRACEPARENT: `00-${traceIdOf("run-1")}-${stepSpanIdOf("s-agent")}-01`,
			OTEL_LOG_USER_PROMPTS: "0",
			OTEL_LOG_TOOL_DETAILS: "0",
		});
		expect(
			h.telemetry.sessionEnv({
				harness: "codex",
				runId: "run-1",
				stepId: "s-agent",
			}),
		).toEqual({});
		await h.telemetry.stop();
	});

	test("headers are kept outside the settings, read back by name only, and used at once", async () => {
		const h = setup();
		await h.telemetry.refresh();
		expect(await h.telemetry.headers.save("api-key=secret-1")).toEqual([
			"api-key",
		]);
		expect(await h.telemetry.headers.names()).toEqual(["api-key"]);
		expect(h.values.get("otlp-headers")).toBe(
			JSON.stringify({ "api-key": "secret-1" }),
		);
		// The export started again with the new headers.
		expect(h.targets).toEqual([
			{
				endpoint: "http://localhost:4318",
				protocol: "http/protobuf",
				headers: {},
			},
			{
				endpoint: "http://localhost:4318",
				protocol: "http/protobuf",
				headers: { "api-key": "secret-1" },
			},
		]);
		expect(h.telemetry.headers.save("no value here")).rejects.toThrow(
			"Check the format",
		);
		expect(await h.telemetry.headers.save(null)).toEqual([]);
		expect(h.values.has("otlp-headers")).toBe(false);
		await h.telemetry.stop();
	});

	test("turning the setting off stops the export with no restart; on starts it again", async () => {
		const h = setup();
		await h.telemetry.refresh();
		expect(h.telemetry.active()).toBe(true);
		h.settings.enabled = false;
		await h.telemetry.refresh();
		expect(h.telemetry.active()).toBe(false);
		h.land(LANDINGS[0] ?? []);
		h.settings.enabled = true;
		h.settings.protocol = "http/json";
		await h.telemetry.refresh();
		expect(h.telemetry.active()).toBe(true);
		expect(h.targets).toHaveLength(2);
		await h.telemetry.stop();
		// The landing while it was off made nothing.
		expect(h.spans()).toEqual([]);
	});
});
