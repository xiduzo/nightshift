import type { LandedFact, RunTrace } from "@nightshift/engine";
import type { Attributes, Counter, Histogram } from "@opentelemetry/api";

import {
	ATTR,
	ERROR_TYPE,
	innerSpanIdOf,
	laterSpanIdOf,
	METRIC,
	OPERATION,
	PROVIDER,
	runSpanIdOf,
	SPAN,
	stepSpanIdOf,
	TOKEN_MODALITY,
	traceIdOf,
} from "../conventions";
import { meterOf, type RunningExport } from "../otlp";

/**
 * The runs of this computer as spans and metric points: a projection of
 * the landed facts, never a second record. Each fact that ends something
 * (a step, a run) reads the run as the engine derives it (`runTrace`) and
 * writes the part that ended, with the ids any process can work out. A
 * landing is told once per process, so nothing is counted twice: a step
 * that ends again after a reopen writes only its new part.
 *
 * The trace tells which sessions, waits and sleeps belong to a part and
 * what they cost: this module only names them. The cost of a part is what
 * the run's spend (the Spend tab) counts for it, sessions cut short
 * included, each with how sure it is.
 *
 * - `step-ended`: `invoke_agent {node}` for an Agent. A Command step, a
 *   Tool step and every other step the flow runs is `nightshift.step {node}`.
 *   That is not `execute_tool`. `execute_tool` is a tool an agent calls.
 *   A Gate wait is `gate {node}`. A sleep is `wait {reason}`.
 * - `run-ended`: the run's span (`invoke_workflow {flow}`), the trace's
 *   root; a resumed run's later end is a span under it.
 * - `scored`: a score: a Gate's answer, a useful answer, what became of a
 *   pull request, or a score the flow wrote.
 */

/** The run as the engine derives it, or null when it has none. */
export type ReadTrace = (runId: string) => Promise<RunTrace | null>;

type Step = RunTrace["steps"][number];
type StepEnd = Step["ends"][number];

const ERROR_CLASSES = new Set<string>(Object.values(ERROR_TYPE));

/** A closed class when the message is one, else the registry's other value. */
function errorTypeOf(message: string | null | undefined): string {
	if (message && ERROR_CLASSES.has(message)) return message;
	return ERROR_TYPE.other;
}

/** The provider name for a harness. Anything else is the custom value. */
function providerOf(harness: string | undefined): string {
	switch (harness) {
		case "claude-code":
			return PROVIDER.claudeCode;
		case "codex":
			return PROVIDER.codex;
		case "grok-build":
			return PROVIDER.grokBuild;
		case "gemini":
			return PROVIDER.gemini;
		default:
			return PROVIDER.other;
	}
}

function workflowName(run: RunTrace): string {
	return run.flowName ?? "quick run";
}

type Instruments = {
	workflowDuration: Histogram;
	agentDuration: Histogram;
	stepDuration: Histogram;
	cost: Counter;
	inputTokens: Counter;
	outputTokens: Counter;
	cacheReadTokens: Counter;
	cacheWriteTokens: Counter;
	retries: Counter;
	gateWait: Histogram;
	runOutcome: Counter;
	score: Counter;
};

function instruments(running: RunningExport): Instruments {
	const meter = meterOf(running);
	const histogram = (m: { name: string; unit: string }, description: string) =>
		meter.createHistogram(m.name, { unit: m.unit, description });
	const counter = (m: { name: string; unit: string }, description: string) =>
		meter.createCounter(m.name, { unit: m.unit, description });
	return {
		workflowDuration: histogram(
			METRIC.workflowDuration,
			"How long a run took, start to end.",
		),
		agentDuration: histogram(
			METRIC.agentDuration,
			"How long an Agent step took.",
		),
		stepDuration: histogram(
			METRIC.stepDuration,
			"How long a step other than an Agent took.",
		),
		cost: counter(METRIC.cost, "What runs cost, in USD."),
		inputTokens: counter(METRIC.inputTokens, "Input tokens a session used."),
		outputTokens: counter(METRIC.outputTokens, "Output tokens a session used."),
		cacheReadTokens: counter(
			METRIC.cacheReadTokens,
			"Cache-read input tokens a session used.",
		),
		cacheWriteTokens: counter(
			METRIC.cacheWriteTokens,
			"Cache-write input tokens a session used.",
		),
		retries: counter(
			METRIC.retries,
			"Steps that ran again: a visit after the first.",
		),
		gateWait: histogram(
			METRIC.gateWait,
			"How long a Gate waited for a person.",
		),
		runOutcome: counter(
			METRIC.runOutcome,
			"Runs that ended, by how they ended.",
		),
		score: counter(
			METRIC.score,
			"Feedback on runs: Gate answers, useful answers, what became of a pull request, and the scores a flow writes.",
		),
	};
}

/** What every span and point of a run carries. */
function runAttributes(run: RunTrace): Attributes {
	return {
		[ATTR.runId]: run.runId,
		[ATTR.conversationId]: run.runId,
		...(run.projectId ? { [ATTR.projectId]: run.projectId } : {}),
		...(run.flowName ? { [ATTR.flowId]: run.flowName } : {}),
	};
}

/** What a metric point of a run carries: no ids of one run or step. */
function runMetricAttributes(run: RunTrace): Attributes {
	return {
		...(run.projectId ? { [ATTR.projectId]: run.projectId } : {}),
		[ATTR.flowId]: run.flowName ?? "quick-run",
	};
}

/** The span name of a step. An Agent is invoke_agent. Every other step is nightshift.step. */
function stepName(step: Step): { name: string; agent: boolean } {
	if (step.nodeType === "agent") {
		return { name: `${OPERATION.agent} ${step.nodeId}`, agent: true };
	}
	return { name: `${SPAN.step} ${step.nodeId}`, agent: false };
}

export type RunProjection = {
	/** Writes what the facts of one landing ended. In order, one landing at a time. */
	take(facts: readonly LandedFact[]): Promise<void>;
};

export function createRunProjection(deps: {
	running: RunningExport;
	read: ReadTrace;
	/** This computer's Device: the Walker of the runs, and where a step without one ran. */
	deviceId: string;
}): RunProjection {
	const { running, read, deviceId } = deps;
	const m = instruments(running);
	const span = running.writeSpan;

	function stepEnded(run: RunTrace, step: Step, end: StepEnd): void {
		const traceId = traceIdOf(run.runId);
		const { sessions } = end;
		const last = sessions.at(-1);
		const device = step.deviceId ?? deviceId;
		const { name, agent } = stepName(step);
		const provider = providerOf(last?.harness);
		const usage = sessions.reduce(
			(total, session) => ({
				input: total.input + session.tokens.input,
				output: total.output + session.tokens.output,
				cacheRead: total.cacheRead + session.tokens.cacheRead,
				cacheWrite: total.cacheWrite + session.tokens.cacheWrite,
			}),
			{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		);
		const who = last
			? {
					[ATTR.agent]: last.harness,
					...(last.model ? { [ATTR.model]: last.model } : {}),
				}
			: {};
		const spanId = end.first
			? stepSpanIdOf(step.id)
			: laterSpanIdOf(step.id, end.seq);
		const failed = end.error
			? { [ATTR.errorType]: errorTypeOf(end.error) }
			: {};
		span({
			name,
			traceId,
			spanId,
			parentSpanId: step.parentStepId
				? stepSpanIdOf(step.parentStepId)
				: runSpanIdOf(run.runId),
			from: end.openedAt,
			to: end.at,
			attributes: {
				...runAttributes(run),
				[ATTR.stepId]: step.id,
				[ATTR.nodeId]: step.nodeId,
				[ATTR.nodeKind]: step.nodeType,
				[ATTR.visit]: step.visit,
				[ATTR.outcome]: end.outcome,
				[ATTR.deviceId]: device,
				...(agent
					? {
							[ATTR.operation]: OPERATION.agent,
							[ATTR.provider]: provider,
							[ATTR.agentName]: step.nodeId,
							...(usage.input > 0 ? { [ATTR.usageInput]: usage.input } : {}),
							...(usage.output > 0 ? { [ATTR.usageOutput]: usage.output } : {}),
							...(usage.cacheRead > 0
								? { [ATTR.usageCacheRead]: usage.cacheRead }
								: {}),
							...(usage.cacheWrite > 0
								? { [ATTR.usageCacheWrite]: usage.cacheWrite }
								: {}),
						}
					: {}),
				...who,
				...(end.knowledge.searches > 0
					? { [ATTR.knowledgeSearches]: end.knowledge.searches }
					: {}),
				...(end.knowledge.reads > 0
					? { [ATTR.knowledgeReads]: end.knowledge.reads }
					: {}),
				...failed,
			},
			error: end.error,
		});

		const point = {
			...runMetricAttributes(run),
			[ATTR.nodeKind]: step.nodeType,
			[ATTR.deviceId]: device,
		};
		for (const wait of end.gateWaits) {
			const ms = Math.max(wait.to - wait.from, 0);
			span({
				name: `${SPAN.gate} ${step.nodeId}`,
				traceId,
				spanId: innerSpanIdOf(step.id, "gate", wait.from),
				parentSpanId: spanId,
				from: wait.from,
				to: wait.to,
				attributes: {
					...runAttributes(run),
					[ATTR.stepId]: step.id,
					[ATTR.nodeId]: step.nodeId,
					[ATTR.nodeKind]: step.nodeType,
					[ATTR.gateWaitMs]: ms,
				},
			});
			m.gateWait.record(ms / 1000, point);
		}
		for (const sleep of end.sleeps) {
			span({
				name: `${SPAN.wait} ${sleep.reason}`,
				traceId,
				spanId: innerSpanIdOf(step.id, "wait", sleep.from),
				parentSpanId: spanId,
				from: sleep.from,
				to: sleep.to,
				attributes: {
					...runAttributes(run),
					[ATTR.stepId]: step.id,
					[ATTR.nodeKind]: step.nodeType,
					[ATTR.waitReason]: sleep.reason,
				},
			});
		}

		const seconds = Math.max(end.at - end.openedAt, 0) / 1000;
		if (agent) {
			m.agentDuration.record(seconds, {
				...point,
				[ATTR.operation]: OPERATION.agent,
				[ATTR.provider]: provider,
				[ATTR.agentName]: step.nodeId,
				[ATTR.workflowName]: workflowName(run),
				...who,
				...failed,
			});
		} else {
			m.stepDuration.record(seconds, {
				...point,
				[ATTR.outcome]: end.outcome,
				...who,
				...failed,
			});
		}
		if (end.first && step.visit > 1) m.retries.add(1, point);
		if (end.costUsd !== null && end.costUsd > 0) {
			m.cost.add(end.costUsd, { ...point, [ATTR.costBasis]: end.costBasis });
		}
		for (const session of sessions) {
			const sessionProvider = providerOf(session.harness);
			const labels = {
				...point,
				[ATTR.agent]: session.harness,
				...(session.model ? { [ATTR.model]: session.model } : {}),
				[ATTR.operation]: OPERATION.agent,
				[ATTR.provider]: sessionProvider,
				[ATTR.tokenModality]: TOKEN_MODALITY.unknown,
			};
			if (session.costUsd !== null && session.costUsd > 0) {
				m.cost.add(session.costUsd, {
					...point,
					[ATTR.agent]: session.harness,
					...(session.model ? { [ATTR.model]: session.model } : {}),
					[ATTR.costBasis]: session.costBasis,
				});
			}
			const { input, output, cacheRead, cacheWrite } = session.tokens;
			if (input > 0) m.inputTokens.add(input, labels);
			if (output > 0) m.outputTokens.add(output, labels);
			if (cacheRead > 0) m.cacheReadTokens.add(cacheRead, labels);
			if (cacheWrite > 0) m.cacheWriteTokens.add(cacheWrite, labels);
		}
	}

	function runEnded(run: RunTrace, end: RunTrace["ends"][number]): void {
		const from = end.first ? (run.startedAt ?? end.openedAt) : end.openedAt;
		const failed = end.status === "failed";
		span({
			name: `${OPERATION.workflow} ${workflowName(run)}`,
			traceId: traceIdOf(run.runId),
			spanId: end.first
				? runSpanIdOf(run.runId)
				: laterSpanIdOf(run.runId, end.seq),
			parentSpanId: end.first ? null : runSpanIdOf(run.runId),
			from,
			to: end.at,
			attributes: {
				...runAttributes(run),
				[ATTR.operation]: OPERATION.workflow,
				[ATTR.workflowName]: workflowName(run),
				[ATTR.deviceId]: deviceId,
				[ATTR.trigger]: run.trigger,
				[ATTR.status]: end.status,
				...(end.reason ? { [ATTR.reason]: end.reason } : {}),
				...(end.first ? {} : { [ATTR.resumed]: true }),
				[ATTR.neededYou]: end.neededYou,
				...(failed ? { [ATTR.errorType]: errorTypeOf(end.endReason) } : {}),
			},
			error: failed ? (end.reason ?? "failed") : null,
		});
		const point = { ...runMetricAttributes(run), [ATTR.deviceId]: deviceId };
		m.workflowDuration.record(Math.max(end.at - from, 0) / 1000, {
			...point,
			[ATTR.workflowName]: workflowName(run),
			[ATTR.operation]: OPERATION.workflow,
			[ATTR.status]: end.status,
			...(failed ? { [ATTR.errorType]: errorTypeOf(end.endReason) } : {}),
		});
		m.runOutcome.add(1, {
			...point,
			[ATTR.status]: end.status,
			[ATTR.neededYou]: end.neededYou,
		});
	}

	function scored(
		run: RunTrace,
		fact: Extract<LandedFact, { kind: "scored" }>,
	): void {
		const point = { ...runMetricAttributes(run), [ATTR.deviceId]: deviceId };
		m.score.add(fact.value, {
			...point,
			[ATTR.score]: fact.score,
			...(fact.label ? { [ATTR.scoreLabel]: fact.label } : {}),
			...(fact.by ? { [ATTR.scoreBy]: fact.by } : {}),
		});
	}

	async function one(fact: LandedFact): Promise<void> {
		if (
			fact.kind !== "step-ended" &&
			fact.kind !== "run-ended" &&
			fact.kind !== "scored"
		) {
			return;
		}
		const run = await read(fact.runId);
		if (!run) return;
		if (fact.kind === "step-ended") {
			const step = run.steps.find((s) => s.id === fact.stepId);
			const end = step?.ends.find((e) => e.seq === fact.seq);
			if (step && end) stepEnded(run, step, end);
		} else if (fact.kind === "run-ended") {
			const end = run.ends.find((e) => e.seq === fact.seq);
			if (end) runEnded(run, end);
		} else {
			scored(run, fact);
		}
	}

	return {
		async take(facts) {
			for (const fact of facts) await one(fact);
		},
	};
}
