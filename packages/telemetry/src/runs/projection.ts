import type { LandedFact, RunTrace } from "@nightshift/engine";
import type { Attributes, Counter, Histogram } from "@opentelemetry/api";

import {
	ATTR,
	innerSpanIdOf,
	laterSpanIdOf,
	METRIC,
	OPERATION,
	runSpanIdOf,
	stepSpanIdOf,
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
 * - `step-ended`: a span for the step's part from its (re)opening to its
 *   end: `invoke_agent {node}` for an Agent, `execute_tool {node}` for a
 *   Command or a Tool, `{kind} {node}` for any other, with a span inside
 *   per Gate wait (`gate {node}`, `nightshift.gate.wait_ms`) and per sleep
 *   (`wait {reason}`). The step's time, its sessions' tokens and cost, a
 *   retry (a visit after the first) and each Gate wait as metric points.
 * - `run-ended`: the run's span (`invoke_workflow {flow}`), the trace's
 *   root; a resumed run's later end is a span under it. Its time and how
 *   it ended.
 * - `scored`: a score, with its name, label and who answered a Gate.
 */

/** The run as the engine derives it, or null when it has none. */
export type ReadTrace = (runId: string) => Promise<RunTrace | null>;

type Step = RunTrace["steps"][number];
type StepEnd = Step["ends"][number];

type Instruments = {
	runDuration: Histogram;
	stepDuration: Histogram;
	cost: Counter;
	tokens: Counter;
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
		runDuration: histogram(
			METRIC.runDuration,
			"How long a run took, start to end.",
		),
		stepDuration: histogram(METRIC.stepDuration, "How long a step took."),
		cost: counter(METRIC.cost, "What runs cost, in USD."),
		tokens: counter(METRIC.tokens, "Tokens the agent sessions used."),
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
			"Feedback on runs: Gate answers, and later pull request outcomes.",
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

/** The span name and GenAI operation of a step. */
function stepName(step: Step): { name: string; operation: string | null } {
	if (step.nodeType === "agent") {
		return {
			name: `${OPERATION.agent} ${step.nodeId}`,
			operation: OPERATION.agent,
		};
	}
	if (step.nodeType === "command" || step.nodeType === "tool") {
		return {
			name: `${OPERATION.tool} ${step.nodeId}`,
			operation: OPERATION.tool,
		};
	}
	return { name: `${step.nodeType} ${step.nodeId}`, operation: null };
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
		const { name, operation } = stepName(step);
		const agent = last
			? {
					[ATTR.agent]: last.harness,
					...(last.model ? { [ATTR.model]: last.model } : {}),
				}
			: {};
		const spanId = end.first
			? stepSpanIdOf(step.id)
			: laterSpanIdOf(step.id, end.seq);
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
				...(operation ? { [ATTR.operation]: operation } : {}),
				...(operation === OPERATION.tool
					? { [ATTR.toolName]: step.nodeId }
					: {}),
				...agent,
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
				name: `gate ${step.nodeId}`,
				traceId,
				spanId: innerSpanIdOf(step.id, "gate", wait.from),
				parentSpanId: spanId,
				from: wait.from,
				to: wait.to,
				attributes: {
					...runAttributes(run),
					[ATTR.stepId]: step.id,
					[ATTR.nodeKind]: step.nodeType,
					[ATTR.gateWaitMs]: ms,
				},
			});
			m.gateWait.record(ms / 1000, point);
		}
		for (const sleep of end.sleeps) {
			span({
				name: `wait ${sleep.reason}`,
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

		m.stepDuration.record(Math.max(end.at - end.openedAt, 0) / 1000, {
			...point,
			[ATTR.outcome]: end.outcome,
			...agent,
		});
		if (end.first && step.visit > 1) m.retries.add(1, point);
		if (end.costUsd !== null && end.costUsd > 0) {
			m.cost.add(end.costUsd, { ...point, [ATTR.basis]: end.costBasis });
		}
		for (const session of sessions) {
			const who = {
				...point,
				[ATTR.agent]: session.harness,
				...(session.model ? { [ATTR.model]: session.model } : {}),
			};
			if (session.costUsd !== null && session.costUsd > 0) {
				m.cost.add(session.costUsd, {
					...who,
					[ATTR.basis]: session.costBasis,
				});
			}
			const { input, output, cacheRead, cacheWrite } = session.tokens;
			const counts: [string, number][] = [
				["input", input],
				["output", output],
				["cache_read", cacheRead],
				["cache_write", cacheWrite],
			];
			for (const [type, count] of counts) {
				if (count > 0) m.tokens.add(count, { ...who, [ATTR.tokenType]: type });
			}
		}
	}

	function runEnded(run: RunTrace, end: RunTrace["ends"][number]): void {
		const from = end.first ? (run.startedAt ?? end.openedAt) : end.openedAt;
		span({
			name: `${OPERATION.workflow} ${run.flowName ?? "quick run"}`,
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
				[ATTR.deviceId]: deviceId,
				[ATTR.trigger]: run.trigger,
				[ATTR.status]: end.status,
				...(end.reason ? { [ATTR.reason]: end.reason } : {}),
				...(end.first ? {} : { [ATTR.resumed]: true }),
			},
			error: end.status === "failed" ? (end.reason ?? "failed") : null,
		});
		const point = { ...runMetricAttributes(run), [ATTR.deviceId]: deviceId };
		m.runDuration.record(Math.max(end.at - from, 0) / 1000, {
			...point,
			[ATTR.status]: end.status,
		});
		m.runOutcome.add(1, { ...point, [ATTR.status]: end.status });
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
