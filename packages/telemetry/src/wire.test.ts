import { describe, expect, test } from "bun:test";
import type { LandedFact } from "@nightshift/engine";
import {
	createConnectionStore,
	createSandbox,
	createSettingsStore,
	runEvents,
	waitFor,
} from "@nightshift/engine/testing";
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
import { createTelemetry } from "./wire";

/*
 * The export over in-memory exporters: what a run's facts give as spans
 * and metric points, the environment of a Claude Code session, headers
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
async function setup(
	initial: Partial<Monitoring> = {},
	run: ReturnType<typeof runEvents> = nightRun(),
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
	const spans = new KeptSpans();
	const metrics = new KeptMetrics(AggregationTemporality.CUMULATIVE);
	const targets: unknown[] = [];
	const telemetry = await createTelemetry({
		deviceId: DEVICE,
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
		async done() {
			await telemetry.stop();
			await sandbox.cleanup();
		},
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
		expect(run.startTime).toEqual([1_700_000_001, 0]);
		expect(run.endTime).toEqual([1_700_000_009, 0]);

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
			"nightshift.knowledge.searches": 1,
		});
		expect(agent.attributes["nightshift.knowledge.reads"]).toBeUndefined();

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
				?.map((p) => [p.attributes["nightshift.run.status"], p.value]),
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

	test("a run cut short exports what the Spend tab counts, with how sure each cost is", async () => {
		const h = await setup({}, cutShortRun());
		h.landRun();
		await h.done();
		const cost = h.points().get("nightshift.run.cost_usd");
		expect(sum(cost, { basis: "billed" })).toBe(0);
		expect(sum(cost, { basis: "estimated" })).toBeCloseTo(0.45);
		expect(sum(cost, { "nightshift.agent": "codex" })).toBeCloseTo(0.4);
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
			sum(h.points().get("nightshift.score"), {
				"nightshift.score.name": "gate_decision",
				"nightshift.score.label": "yes",
				"nightshift.score.by": "person",
			}),
		).toBe(1);
	});

	test("a pull request's scores count, and as what became of it", async () => {
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
		const outcomes = h.points().get("nightshift.pr.outcome");
		expect(sum(outcomes, { outcome: "merged" })).toBe(1);
		expect(sum(outcomes, { outcome: "reverted" })).toBe(1);
		expect(sum(outcomes, { outcome: "closed" })).toBe(0);
		expect(
			sum(h.points().get("nightshift.score"), {
				"nightshift.score.name": "pr_merged",
			}),
		).toBe(1);
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
			OTEL_RESOURCE_ATTRIBUTES:
				"nightshift.run.id=run-1,nightshift.step.id=s-agent,nightshift.device.id=mac",
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
				OTEL_RESOURCE_ATTRIBUTES:
					"nightshift.run.id=run-1,nightshift.step.id=s-agent,nightshift.device.id=mac",
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
});
