import { afterEach, describe, expect, test } from "bun:test";
import { arch, type as osTypeName } from "node:os";
import type { LandedFact } from "@nightshift/engine";
import {
	createConnectionStore,
	createSandbox,
	createSettingsStore,
	runEvents,
	waitFor,
} from "@nightshift/engine/testing";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
	AggregationTemporality,
	type DataPoint,
	DataPointType,
	type Histogram,
	InMemoryMetricExporter,
	type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import {
	InMemorySpanExporter,
	type ReadableSpan,
} from "@opentelemetry/sdk-trace";
import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

import {
	ATTR,
	ERROR_TYPE,
	METRIC,
	OPERATION,
	PROVIDER,
	runSpanIdOf,
	SERVICE_NAME,
	SPAN,
	stepSpanIdOf,
	TOKEN_MODALITY,
	traceIdOf,
} from "./conventions";
import { assertConforms } from "./runs";
import { createTelemetry } from "./wire";

/*
 * The export over in-memory exporters: what a run's facts give as spans
 * and metric points, the spans of an API request, the environment of a
 * Claude Code or Codex session, headers
 * whose secrets stay in the secrets, and nothing at all while the setting
 * is off.
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

/**
 * When the run starts, in epoch ms. The SDK reads a small number as time
 * since this process started, so the run starts at a real date.
 */
const T = 1_700_000_000_000;

/** A run of a flow: an Agent, a Gate that waited, a Call with a Wait inside, then it finished. */
function nightRun() {
	const on = (
		nodeType: "agent" | "decision" | "call" | "wait",
		extra: object = {},
	) => ({
		nodeType,
		deviceId: DEVICE,
		...extra,
	});
	return runEvents("run-1")
		.at(T + 1_000)
		.runStarted({
			projectId: "p1",
			flowName: "nightly",
			trigger: { kind: "schedule", scheduleId: "nightly", at: T },
		})
		.at(T + 1_100)
		.stepStarted("s-agent", "build", 1, on("agent"))
		.at(T + 1_200)
		.sessionStarted("s-agent", "x1", { harness: "claude-code" })
		.harness("s-agent", "x1", "h1", "claude-sonnet")
		.push(
			"KnowledgeSearched",
			{ projectId: "p1", query: "deploy", hits: [], via: "step" },
			{ stepId: "s-agent", sessionId: "x1" },
		)
		.at(T + 3_000)
		.sessionEnded("s-agent", "x1", "finished", 0.75, {
			usage: { inputTokens: 900, outputTokens: 100, cacheReadTokens: 400 },
			costSource: "reported",
		})
		.at(T + 3_100)
		.stepEnded("s-agent", "pass")
		.at(T + 3_150)
		.stepStarted("s-gate", "ship", 1, on("decision"))
		.at(T + 3_200)
		.gateOpened("s-gate")
		.at(T + 6_200)
		.stepEnded("s-gate", "yes")
		.at(T + 6_300)
		.stepStarted("s-call", "each", 1, on("call"))
		.at(T + 6_400)
		.stepStarted(
			"s-wait",
			"pause",
			2,
			on("wait", { scope: { parentStepId: "s-call", itemId: null } }),
		)
		.at(T + 6_500)
		.waitStarted("s-wait", { reason: "duration" })
		.at(T + 8_300)
		.waitEnded("s-wait")
		.at(T + 8_400)
		.stepEnded("s-wait", "done")
		.at(T + 8_900)
		.stepEnded("s-call", "done")
		.at(T + 9_000)
		.ended("finished");
}

/** A run Night Shift stopped during an Agent's session, after a decider priced its answer. */
function cutShortRun() {
	return runEvents("run-1")
		.at(T + 1_000)
		.runStarted({ projectId: "p1", flowName: "nightly" })
		.stepStarted("s-decide", "decide", 1, { deviceId: DEVICE })
		.push(
			"StepEnded",
			{
				outcome: "yes",
				outputs: {},
				error: null,
				costUsd: 0.05,
				costSource: "estimated",
			},
			{ stepId: "s-decide" },
		)
		.stepStarted("s-agent", "build", 1, { deviceId: DEVICE })
		.sessionStarted("s-agent", "x1", { harness: "codex" })
		.push(
			"SessionUsage",
			{
				usage: { inputTokens: 10, outputTokens: 5 },
				costUsd: 0.4,
				costSource: "estimated",
			},
			{ stepId: "s-agent", sessionId: "x1" },
		)
		.stepEnded("s-agent", "interrupted")
		.ended("interrupted");
}

type Monitoring = {
	telemetry: boolean;
	telemetryEndpoint: string;
	telemetryProtocol: "http/protobuf" | "http/json";
	telemetryHeaders: Record<string, string>;
};

/**
 * A telemetry over a fake engine and this computer's real settings and
 * secrets, with the secret values in memory.
 */
let restoreEnv = () => {};
afterEach(() => restoreEnv());

const OTEL_KEYS = [
	"OTEL_SDK_DISABLED",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_RESOURCE_ATTRIBUTES",
	"NIGHTSHIFT_VERSION",
];

async function setup(
	initial: Partial<Monitoring> = {},
	run: ReturnType<typeof runEvents> = nightRun(),
	env: Record<string, string> = {},
) {
	let listener: ((facts: readonly LandedFact[]) => void) | null = null;
	let scope: unknown = null;
	const sandbox = await createSandbox();
	const document = await sandbox.openDocument();
	const kept = new Map<string, string>();
	const settings = createSettingsStore({ document, env: {} });
	const secrets = createConnectionStore({
		document,
		env: {},
		secrets: {
			get: async (name) => kept.get(name) ?? null,
			set: async (name, value) => {
				kept.set(name, value);
			},
			delete: async (name) => {
				kept.delete(name);
			},
		},
	});
	await settings.save({
		telemetry: true,
		telemetryEndpoint: "http://localhost:4318",
		telemetryProtocol: "http/protobuf",
		...initial,
	});
	const savedEnv = new Map<string, string | undefined>();
	for (const key of OTEL_KEYS) {
		savedEnv.set(key, process.env[key]);
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(env)) process.env[key] = value;
	let restored = false;
	restoreEnv = () => {
		if (restored) return;
		restored = true;
		for (const [key, value] of savedEnv) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
	const spans = new KeptSpans();
	const metrics = new KeptMetrics(AggregationTemporality.CUMULATIVE);
	const targets: unknown[] = [];
	const telemetry = await createTelemetry({
		deviceId: DEVICE,
		db: sandbox.db,
		settings,
		secrets,
		sinks: (target) => {
			targets.push(target);
			return { spans, metrics };
		},
	});
	telemetry.follow({
		onLandedFacts: (l, s) => {
			listener = l;
			scope = s;
			return () => {
				listener = null;
			};
		},
		runTrace: async (runId) => (runId === "run-1" ? run.trace() : null),
	});
	const agentEnv = () =>
		telemetry.sessionEnv({
			harness: "claude-code",
			runId: "run-1",
			stepId: "s-agent",
		});
	return {
		telemetry,
		settings,
		secrets,
		targets,
		/** Whether the export is on now: a Claude Code step gets its telemetry. */
		on: () => Object.keys(agentEnv().env).length > 0,
		agentEnv,
		scope: () => scope,
		land: (facts: LandedFact[]) => listener?.(facts),
		/** Lands the run's events in one landing, as the engine tells them. */
		landRun: () => listener?.(run.facts()),
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
		resources: () => metrics.getMetrics(),
		async done() {
			await telemetry.stop();
			await sandbox.cleanup();
			restoreEnv();
		},
	};
}

function expectedOs(): string {
	if (osTypeName() === "Darwin") return "darwin";
	if (osTypeName() === "Linux") return "linux";
	if (osTypeName() === "Windows_NT") return "windows";
	return osTypeName().toLowerCase();
}

function expectedArch(): string {
	if (arch() === "x64") return "amd64";
	if (arch() === "ia32") return "x86";
	if (arch() === "arm") return "arm32";
	return arch();
}

function instrumentOf(metric: {
	dataPointType: DataPointType;
	isMonotonic?: boolean;
}): string {
	if (metric.dataPointType === DataPointType.HISTOGRAM) return "histogram";
	if (metric.dataPointType === DataPointType.SUM && metric.isMonotonic) {
		return "counter";
	}
	return String(metric.dataPointType);
}

/** The in-memory export, in the shape the registry check reads. */
function exported(
	spans: ReadableSpan[],
	resources: ResourceMetrics[],
): {
	spans: {
		name: string;
		failed: boolean;
		attributes: Record<string, unknown>;
	}[];
	metrics: {
		name: string;
		unit: string;
		instrument: string;
		points: { attributes: Record<string, unknown> }[];
	}[];
} {
	return {
		spans: spans.map((span) => ({
			name: span.name,
			failed: span.status.code === SpanStatusCode.ERROR,
			attributes: { ...span.attributes },
		})),
		metrics: resources.flatMap((resource) =>
			resource.scopeMetrics.flatMap((scoped) =>
				scoped.metrics.map((metric) => ({
					name: metric.descriptor.name,
					unit: metric.descriptor.unit ?? "",
					instrument: instrumentOf(metric),
					points: metric.dataPoints.map((point) => ({
						attributes: { ...point.attributes },
					})),
				})),
			),
		),
	};
}

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
		const h = await setup({ telemetry: false });
		h.landRun();
		expect(h.agentEnv()).toEqual({ env: {}, values: [] });
		await h.done();
		expect(h.targets).toEqual([]);
		expect(h.spans()).toEqual([]);
	});

	test("on without an endpoint, it stays off", async () => {
		const h = await setup({ telemetryEndpoint: "" });
		expect(h.on()).toBe(false);
		await h.done();
		expect(h.targets).toEqual([]);
	});

	test("a run's facts give one trace: the run, its steps, a Gate's wait and a sleep", async () => {
		const h = await setup();
		expect(h.scope()).toEqual({ only: DEVICE });
		h.landRun();
		await h.done();

		const spans = h.spans();
		expect(spans.map((s) => s.name).sort()).toEqual(
			[
				`${SPAN.gate} ship`,
				`${OPERATION.agent} build`,
				`${OPERATION.workflow} nightly`,
				`${SPAN.step} each`,
				`${SPAN.step} pause`,
				`${SPAN.step} ship`,
				`${SPAN.wait} duration`,
			].sort(),
		);
		const traceId = traceIdOf("run-1");
		expect(new Set(spans.map((s) => s.spanContext().traceId))).toEqual(
			new Set([traceId]),
		);

		const run = byName(spans, "invoke_workflow nightly");
		expect(run.spanContext().spanId).toBe(runSpanIdOf("run-1"));
		expect(parentOf(run)).toBeNull();
		expect(run.attributes).toMatchObject({
			[ATTR.runId]: "run-1",
			[ATTR.conversationId]: "run-1",
			[ATTR.projectId]: "p1",
			[ATTR.flowId]: "nightly",
			[ATTR.operation]: "invoke_workflow",
			[ATTR.workflowName]: "nightly",
			[ATTR.deviceId]: DEVICE,
			[ATTR.status]: "finished",
			[ATTR.trigger]: "schedule",
			// Nobody answered its Gate: the run ran on its own.
			[ATTR.neededYou]: false,
		});
		expect(run.resource.attributes).toMatchObject({
			[ATTR.serviceName]: SERVICE_NAME,
			[ATTR.serviceInstance]: DEVICE,
			[ATTR.deviceId]: DEVICE,
			[ATTR.serviceVersion]: "dev",
			[ATTR.osType]: expectedOs(),
			[ATTR.hostArch]: expectedArch(),
			[ATTR.deploymentEnvironment]: "local",
		});
		expect(run.startTime).toEqual([1_700_000_001, 0]);
		expect(run.endTime).toEqual([1_700_000_009, 0]);

		const agent = byName(spans, "invoke_agent build");
		expect(agent.spanContext().spanId).toBe(stepSpanIdOf("s-agent"));
		expect(parentOf(agent)).toBe(runSpanIdOf("run-1"));
		expect(agent.attributes).toMatchObject({
			[ATTR.stepId]: "s-agent",
			[ATTR.nodeKind]: "agent",
			[ATTR.agent]: "claude-code",
			[ATTR.agentName]: "build",
			[ATTR.provider]: PROVIDER.claudeCode,
			[ATTR.model]: "claude-sonnet",
			[ATTR.operation]: "invoke_agent",
			[ATTR.outcome]: "pass",
			[ATTR.knowledgeSearches]: 1,
			[ATTR.usageInput]: 900,
			[ATTR.usageOutput]: 100,
			[ATTR.usageCacheRead]: 400,
		});
		expect(agent.attributes[ATTR.knowledgeReads]).toBeUndefined();
		expect(agent.attributes[ATTR.usageCacheWrite]).toBeUndefined();

		const gate = byName(spans, "gate ship");
		expect(parentOf(gate)).toBe(stepSpanIdOf("s-gate"));
		expect(gate.attributes[ATTR.gateWaitMs]).toBe(3_000);
		expect(gate.attributes[ATTR.nodeId]).toBe("ship");

		// A step inside a Call hangs under the Call's span, its sleep under it.
		const wait = byName(spans, `${SPAN.step} pause`);
		expect(parentOf(wait)).toBe(stepSpanIdOf("s-call"));
		expect(parentOf(byName(spans, "wait duration"))).toBe(
			stepSpanIdOf("s-wait"),
		);
		expect(byName(spans, "wait duration").attributes[ATTR.waitReason]).toBe(
			"duration",
		);

		const points = h.points();
		expect(
			points
				.get(METRIC.runOutcome.name)
				?.map((p) => [
					p.attributes[ATTR.status],
					p.attributes[ATTR.neededYou],
					p.value,
				]),
		).toEqual([["finished", false, 1]]);
		const runDuration = points.get(METRIC.workflowDuration.name)?.[0]
			?.value as Histogram;
		expect(runDuration.count).toBe(1);
		expect(runDuration.sum).toBe(8);
		expect(sum(points.get(METRIC.inputTokens.name))).toBe(900);
		expect(sum(points.get(METRIC.outputTokens.name))).toBe(100);
		expect(sum(points.get(METRIC.cacheReadTokens.name))).toBe(400);
		expect(points.get(METRIC.cacheWriteTokens.name)).toBeUndefined();
		expect(
			sum(points.get(METRIC.inputTokens.name), {
				[ATTR.tokenModality]: TOKEN_MODALITY.unknown,
				[ATTR.provider]: PROVIDER.claudeCode,
			}),
		).toBe(900);
		expect(
			sum(points.get(METRIC.cost.name), { [ATTR.costBasis]: "billed" }),
		).toBe(0.75);
		expect(
			sum(points.get(METRIC.retries.name), { [ATTR.nodeKind]: "wait" }),
		).toBe(1);
		const gateWait = points.get(METRIC.gateWait.name)?.[0]?.value as Histogram;
		expect(gateWait.sum).toBe(3);
		const steps = points.get(METRIC.stepDuration.name) ?? [];
		expect(steps.reduce((n, p) => n + (p.value as Histogram).count, 0)).toBe(3);
		const agentDuration = points.get(METRIC.agentDuration.name)?.[0]
			?.value as Histogram;
		expect(agentDuration.count).toBe(1);
		// No ids of one run or step on a metric point.
		for (const list of points.values()) {
			for (const point of list) {
				expect(point.attributes[ATTR.runId]).toBeUndefined();
				expect(point.attributes[ATTR.stepId]).toBeUndefined();
			}
		}
		assertConforms(exported(h.spans(), h.resources()));
	});

	test("a run cut short exports what the Spend tab counts, with how sure each cost is", async () => {
		const h = await setup({}, cutShortRun());
		h.landRun();
		await h.done();
		const cost = h.points().get(METRIC.cost.name);
		expect(sum(cost, { [ATTR.costBasis]: "billed" })).toBe(0);
		expect(sum(cost, { [ATTR.costBasis]: "estimated" })).toBeCloseTo(0.45);
		expect(sum(cost, { [ATTR.agent]: "codex" })).toBeCloseTo(0.4);
	});

	test("a run a person stepped in on says so on its span and its outcome", async () => {
		const run = runEvents("run-1")
			.at(T + 1_000)
			.runStarted({ projectId: "p1", flowName: "triage" })
			.at(T + 1_100)
			.stepStarted("s-gate", "ship", 1, {
				nodeType: "decision",
				deviceId: DEVICE,
			})
			.gateOpened("s-gate")
			.at(T + 2_000)
			.push(
				"Scored",
				{ score: "gate_decision", value: 1, label: "approve", by: "person" },
				{ stepId: "s-gate" },
			)
			.stepEnded("s-gate", "approve")
			.at(T + 2_100)
			.ended("finished");
		const h = await setup({}, run);
		h.landRun();
		await h.done();
		const span = byName(h.spans(), "invoke_workflow triage");
		expect(span.attributes[ATTR.neededYou]).toBe(true);
		expect(
			h
				.points()
				.get(METRIC.runOutcome.name)
				?.map((p) => [p.attributes[ATTR.neededYou], p.value]),
		).toEqual([[true, 1]]);
		assertConforms(exported(h.spans(), h.resources()));
	});

	test("a Gate's answer counts as a score, with who chose", async () => {
		const run = nightRun().push(
			"Scored",
			{ score: "gate_decision", value: 1, label: "yes", by: "person" },
			{ stepId: "s-gate" },
		);
		const h = await setup({}, run);
		h.landRun();
		await h.done();
		expect(
			sum(h.points().get(METRIC.score.name), {
				[ATTR.score]: "gate_decision",
				[ATTR.scoreLabel]: "yes",
				[ATTR.scoreBy]: "person",
			}),
		).toBe(1);
	});

	test("a score a Command step wrote counts unchanged, under the flow's own name", async () => {
		const run = runEvents("run-1")
			.at(T + 1_000)
			.runStarted({ projectId: "p1", flowName: "replicate" })
			.at(T + 1_100)
			.stepStarted("s-check", "replicate", 1, {
				nodeType: "command",
				deviceId: DEVICE,
			})
			.at(T + 2_000)
			.stepEnded("s-check", "pass")
			.push(
				"Scored",
				{ score: "replicated", value: 1, label: null },
				{ stepId: "s-check" },
			)
			.push(
				"Scored",
				{ score: "held_post_publication", value: 0.25, label: null },
				{ stepId: "s-check" },
			)
			.at(T + 2_100)
			.ended("finished");
		const h = await setup({}, run);
		h.landRun();
		await h.done();
		const points = h.points().get(METRIC.score.name) ?? [];
		expect(
			points
				.map((p) => ({ attributes: p.attributes, value: p.value }))
				.sort((a, b) =>
					String(a.attributes[ATTR.score]).localeCompare(
						String(b.attributes[ATTR.score]),
					),
				),
		).toEqual([
			{
				attributes: {
					[ATTR.projectId]: "p1",
					[ATTR.flowId]: "replicate",
					[ATTR.deviceId]: DEVICE,
					[ATTR.score]: "held_post_publication",
				},
				value: 0.25,
			},
			{
				attributes: {
					[ATTR.projectId]: "p1",
					[ATTR.flowId]: "replicate",
					[ATTR.deviceId]: DEVICE,
					[ATTR.score]: "replicated",
				},
				value: 1,
			},
		]);
		assertConforms(exported(h.spans(), h.resources()));
	});

	test("a pull request's scores count under their names, and no other metric tells them", async () => {
		const run = nightRun()
			.push("Scored", {
				score: "pr_merged",
				value: 1,
				label: "0123456789abcdef0123456789abcdef01234567",
			})
			.push("Scored", {
				score: "reverted_within_7d",
				value: 1,
				label: "0123456789ab",
			});
		const h = await setup({}, run);
		h.landRun();
		await h.done();
		const scores = h.points().get(METRIC.score.name);
		expect(sum(scores, { [ATTR.score]: "pr_merged" })).toBe(1);
		expect(sum(scores, { [ATTR.score]: "reverted_within_7d" })).toBe(1);
		expect(sum(scores, { [ATTR.score]: "pr_closed" })).toBe(0);
		const named = new Set<string>(
			Object.values(METRIC).map((metric) => metric.name),
		);
		expect([...h.points().keys()].filter((name) => !named.has(name))).toEqual(
			[],
		);
	});

	test("an API request is a trace of its own while the export is on, and nothing after", async () => {
		const handler = new RPCHandler({
			ping: os
				.use(async ({ next }) => next())
				.handler(async () => {
					await Bun.sleep(1);
					return "pong";
				}),
		});
		const ask = () =>
			handler.handle(
				new Request("http://localhost/rpc/ping", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						// Propagation is off: a caller's trace starts nothing here.
						traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
					},
					body: JSON.stringify({ json: null }),
				}),
				{ prefix: "/rpc" },
			);
		const h = await setup();
		const answer = await ask();
		expect(answer.matched).toBe(true);
		// Another library's spans stay out of the export.
		trace.getTracer("better-auth").startSpan("db findOne session").end();
		await h.settings.save({ telemetry: false });
		await waitFor(() => !h.on(), { label: "the export off" });
		await ask();
		await h.done();

		const spans = h.spans();
		const call = byName(spans, "call_procedure");
		const handled = byName(spans, "handler");
		// One request, one trace, its spans nested under the procedure's.
		const root = byName(spans, "orpc.ping");
		expect(parentOf(root)).toBeNull();
		expect(parentOf(call)).toBe(root.spanContext().spanId);
		expect(handled.spanContext().traceId).toBe(call.spanContext().traceId);
		expect(call.spanContext().traceId).not.toBe("a".repeat(32));
		expect(spans.filter((s) => s.name === "call_procedure")).toHaveLength(1);
		expect(spans.map((s) => s.name)).not.toContain("db findOne session");
		expect(
			spans.every(
				(s) => s.spanContext().traceId === call.spanContext().traceId,
			),
		).toBe(true);
	});

	test("a Claude Code session gets its telemetry under the step, with no content", async () => {
		const h = await setup({
			telemetryHeaders: {
				Authorization: "Bearer ${GRAFANA_TOKEN}",
				"X-Scope-OrgID": "night",
			},
		});
		// The export waits for the secret its headers name.
		expect(h.on()).toBe(false);
		await h.secrets.setSecret("GRAFANA_TOKEN", "abc 123");
		await waitFor(h.on, { label: "the export on" });
		const { env, values } = h.telemetry.sessionEnv({
			harness: "claude-code",
			runId: "run-1",
			stepId: "s-agent",
		});
		// The secret's value comes back as ••• in the session's output.
		expect(values).toEqual(["abc 123"]);
		expect(env).toMatchObject({
			CLAUDE_CODE_ENABLE_TELEMETRY: "1",
			OTEL_METRICS_EXPORTER: "otlp",
			OTEL_LOGS_EXPORTER: "otlp",
			OTEL_TRACES_EXPORTER: "otlp",
			OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
			OTEL_EXPORTER_OTLP_HEADERS:
				"Authorization=Bearer%20abc%20123,X-Scope-OrgID=night",
			OTEL_RESOURCE_ATTRIBUTES: [
				`${ATTR.runId}=run-1`,
				`${ATTR.stepId}=s-agent`,
				`${ATTR.deviceId}=${DEVICE}`,
			].join(","),
			TRACEPARENT: `00-${traceIdOf("run-1")}-${stepSpanIdOf("s-agent")}-01`,
			OTEL_LOG_USER_PROMPTS: "0",
			OTEL_LOG_TOOL_DETAILS: "0",
		});
		expect(
			h.telemetry.sessionEnv({
				harness: "opencode",
				runId: "run-1",
				stepId: "s-agent",
			}),
		).toEqual({ env: {}, values: [] });
		await h.done();
	});

	test("a Codex session gets its telemetry in its config, and the headers only in its environment", async () => {
		const h = await setup({
			telemetryEndpoint: "http://collector:4318/",
			telemetryProtocol: "http/json",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
			telemetryHeaders: { "api-key": "${OTLP_KEY}" },
		});
		await h.secrets.setSecret("OTLP_KEY", "k 1");
		await waitFor(h.on, { label: "the export on" });
		const session = h.telemetry.sessionEnv({
			harness: "codex",
			runId: "run-1",
			stepId: "s-agent",
		});
		expect(session).toEqual({
			env: {
				OTEL_EXPORTER_OTLP_HEADERS: "api-key=k%201",
				OTEL_RESOURCE_ATTRIBUTES: [
					`${ATTR.runId}=run-1`,
					`${ATTR.stepId}=s-agent`,
					`${ATTR.deviceId}=${DEVICE}`,
				].join(","),
				TRACEPARENT: `00-${traceIdOf("run-1")}-${stepSpanIdOf("s-agent")}-01`,
			},
			values: ["k 1"],
			config: {
				"otel.environment": '"nightshift"',
				"otel.log_user_prompt": "false",
				"otel.exporter":
					'{ otlp-http = { endpoint = "http://collector:4318/v1/logs", protocol = "json" } }',
				"otel.trace_exporter":
					'{ otlp-http = { endpoint = "http://collector:4318/v1/traces", protocol = "json" } }',
				"otel.metrics_exporter":
					'{ otlp-http = { endpoint = "http://collector:4318/v1/metrics", protocol = "json" } }',
			},
		});
		// The secret's value never goes on Codex's command line.
		expect(JSON.stringify(session.config)).not.toContain("k 1");
		await h.done();
	});

	test("a header reads its secret when the export starts, and a new value of the secret applies at once", async () => {
		const h = await setup({
			telemetryHeaders: { "api-key": "${OTLP_KEY}" },
		});
		await h.secrets.setSecret("OTLP_KEY", "secret-1");
		await waitFor(() => h.targets.length === 1, { label: "the export" });
		await h.secrets.setSecret("OTLP_KEY", "secret-2");
		await waitFor(() => h.targets.length === 2, { label: "a new export" });
		expect(h.targets).toEqual([
			{
				endpoint: "http://localhost:4318",
				protocol: "http/protobuf",
				headers: { "api-key": "secret-1" },
			},
			{
				endpoint: "http://localhost:4318",
				protocol: "http/protobuf",
				headers: { "api-key": "secret-2" },
			},
		]);
		// The setting holds the reference, never the value.
		expect(h.settings.current().telemetryHeaders).toEqual({
			"api-key": "${OTLP_KEY}",
		});
		await h.done();
	});

	test("turning the setting off stops the export with no restart; on starts it again", async () => {
		const h = await setup();
		expect(h.on()).toBe(true);
		await h.settings.save({ telemetry: false });
		await waitFor(() => !h.on(), { label: "the export off" });
		h.landRun();
		await h.settings.save({ telemetry: true, telemetryProtocol: "http/json" });
		await waitFor(h.on, { label: "the export on" });
		expect(h.targets).toHaveLength(2);
		await h.done();
		// The landing while it was off made nothing.
		expect(h.spans()).toEqual([]);
	});

	test("a failed run sets error.type, and a Command step is not a tool call", async () => {
		const run = runEvents("run-1")
			.at(T + 1_000)
			.runStarted({ projectId: "p1", flowName: "nightly" })
			.stepStarted("s-cmd", "check", 1, { deviceId: DEVICE })
			.stepEnded("s-cmd", "pass")
			.stepStarted("s-agent", "build", 1, { deviceId: DEVICE })
			.push(
				"StepEnded",
				{ outcome: "error", outputs: {}, error: ERROR_TYPE.guardBudget },
				{ stepId: "s-agent" },
			)
			.ended("failed", "the build failed");
		const h = await setup({}, run);
		h.landRun();
		await h.done();
		const spans = h.spans();
		const command = byName(spans, `${SPAN.step} check`);
		expect(command.attributes[ATTR.nodeKind]).toBe("command");
		expect(command.attributes[ATTR.toolName]).toBeUndefined();
		const agent = byName(spans, "invoke_agent build");
		expect(agent.status.code).toBe(SpanStatusCode.ERROR);
		expect(agent.attributes[ATTR.errorType]).toBe(ERROR_TYPE.guardBudget);
		expect(agent.status.message).toBe(ERROR_TYPE.guardBudget);
		const workflow = byName(spans, "invoke_workflow nightly");
		expect(workflow.status.code).toBe(SpanStatusCode.ERROR);
		expect(workflow.attributes[ATTR.errorType]).toBe(ERROR_TYPE.other);
		expect(workflow.status.message).toBe("the build failed");
		expect(h.points().get(METRIC.toolDuration.name)).toBeUndefined();
		assertConforms(exported(spans, h.resources()));
	});

	test("an empty address uses the OTEL endpoint, and a saved address wins", async () => {
		const h = await setup({ telemetryEndpoint: "" }, nightRun(), {
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
			OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
			OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20x",
		});
		expect(h.targets).toEqual([
			{
				endpoint: "http://collector:4318",
				protocol: "http/json",
				headers: { Authorization: "Bearer x" },
			},
		]);
		await h.settings.save({ telemetryEndpoint: "http://saved:4318" });
		await waitFor(() => h.targets.length === 2, { label: "the saved address" });
		expect(h.targets[1]).toMatchObject({ endpoint: "http://saved:4318" });
		await h.done();
	});

	test("the switch stays off when only an OTEL endpoint is set", async () => {
		const h = await setup(
			{ telemetry: false, telemetryEndpoint: "" },
			nightRun(),
			{
				OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
			},
		);
		expect(h.on()).toBe(false);
		expect(h.targets).toEqual([]);
		await h.done();
	});

	test("OTEL_SDK_DISABLED turns the export off, and grpc is not spoken", async () => {
		const disabled = await setup({}, nightRun(), { OTEL_SDK_DISABLED: "true" });
		expect(disabled.on()).toBe(false);
		await disabled.done();
		const grpc = await setup({ telemetryEndpoint: "" }, nightRun(), {
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4317",
			OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
		});
		expect(grpc.on()).toBe(false);
		await grpc.done();
	});

	test("deployment.environment.name comes from OTEL_RESOURCE_ATTRIBUTES", async () => {
		const h = await setup({}, nightRun(), {
			OTEL_RESOURCE_ATTRIBUTES: `${ATTR.deploymentEnvironment}=production`,
			NIGHTSHIFT_VERSION: "1.2.3",
		});
		h.landRun();
		await h.done();
		const run = byName(h.spans(), "invoke_workflow nightly");
		expect(run.resource.attributes[ATTR.deploymentEnvironment]).toBe(
			"production",
		);
		expect(run.resource.attributes[ATTR.serviceVersion]).toBe("1.2.3");
		expect(run.resource.attributes[ATTR.serviceName]).toBe(SERVICE_NAME);
	});
});
