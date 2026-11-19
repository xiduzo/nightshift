import {
	ATTR,
	ERROR_TYPE,
	OPERATION,
	PROVIDER,
	REGISTRY,
	SPAN,
	TOKEN_MODALITY,
} from "@nightshift/semconv";
import type {
	InstrumentName,
	RecordAttributes,
	RunRecord,
	SpanKey,
} from "./run-record";
import type {
	RecordedFact,
	TracedRun,
	TracedRunEnd,
	TracedStep,
	TracedStepEnd,
} from "./traced-run";

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
 * - `scored`: a score of Night Shift's own (a Gate's answer, a useful
 *   answer, what became of a pull request) is a `nightshift.score` point.
 *   A number the flow reports is a `nightshift.flow.metric` point.
 *
 * Where the work landed: the step a climb landed on adds one
 * `nightshift.ladder.rung` point, with its ladder, rung and tier. The cost
 * of a try on a ladder carries the rung that try stands on.
 *
 * A test run (ADR 27) counts only in the spend, as in the app's numbers:
 * it writes the cost and token points of its steps, and no span and no
 * other point. The registry has no attribute that tells a test run apart.
 *
 * This is the rule alone (`recordsOf`). The composition (`wire.ts`) reads
 * the run, works out the ids of the spans (`conventions/ids.ts`) and
 * writes the records to the export.
 */

type Step = TracedStep;
type StepEnd = TracedStepEnd;
type Landing = NonNullable<StepEnd["landing"]>;

/**
 * The scores Night Shift writes itself: the closed list of
 * `nightshift.score.name`, but for its other value. Any other name is a
 * number a flow reports.
 */
const OWN_SCORES: ReadonlySet<string> = new Set(
	REGISTRY.attributes[ATTR.score].members.filter((name) => name !== "_OTHER"),
);

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

function workflowName(run: TracedRun): string {
	return run.flowName ?? "quick run";
}

/** What every span and point of a run carries. */
function runAttributes(run: TracedRun): RecordAttributes {
	return {
		[ATTR.runId]: run.runId,
		[ATTR.conversationId]: run.runId,
		...(run.projectId ? { [ATTR.projectId]: run.projectId } : {}),
		...(run.flowName ? { [ATTR.flowId]: run.flowName } : {}),
	};
}

/** What a metric point of a run carries: no ids of one run or step. */
function runMetricAttributes(run: TracedRun): RecordAttributes {
	return {
		...(run.projectId ? { [ATTR.projectId]: run.projectId } : {}),
		[ATTR.flowId]: run.flowName ?? "quick-run",
	};
}

/**
 * A landing as a point: its ladder, rung and tier. A climb of a Decision
 * also says whether a decider was not sure enough.
 */
function landingAttributes(landing: Landing): RecordAttributes {
	return {
		[ATTR.ladderKind]: landing.ladder,
		[ATTR.ladderRung]: landing.rung,
		...(landing.tier !== null ? { [ATTR.ladderTier]: landing.tier } : {}),
		...(landing.ladder === "choice"
			? { [ATTR.ladderUnsure]: landing.unsure === true }
			: {}),
	};
}

/** The span name of a step. An Agent is invoke_agent. Every other step is nightshift.step. */
function stepName(step: Step): { name: string; agent: boolean } {
	if (step.nodeType === "agent") {
		return { name: `${OPERATION.agent} ${step.nodeId}`, agent: true };
	}
	return { name: `${SPAN.step} ${step.nodeId}`, agent: false };
}

/** Adds a point to `records`. */
function point(
	records: RunRecord[],
	instrument: InstrumentName,
	value: number,
	attributes: RecordAttributes,
): void {
	records.push({ kind: "point", instrument, value, attributes });
}

function stepEnded(
	records: RunRecord[],
	run: TracedRun,
	step: Step,
	end: StepEnd,
	deviceId: string,
): void {
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
	const spanKey: SpanKey = end.first
		? { of: "step", stepId: step.id }
		: { of: "later", id: step.id, seq: end.seq };
	const failed = end.error ? { [ATTR.errorType]: errorTypeOf(end.error) } : {};
	records.push({
		kind: "span",
		name,
		runId: run.runId,
		span: spanKey,
		parent: step.parentStepId
			? { of: "step", stepId: step.parentStepId }
			: { of: "run", runId: run.runId },
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

	const labels = {
		...runMetricAttributes(run),
		[ATTR.nodeKind]: step.nodeType,
		[ATTR.deviceId]: device,
	};
	for (const wait of end.gateWaits) {
		const ms = Math.max(wait.to - wait.from, 0);
		records.push({
			kind: "span",
			name: `${SPAN.gate} ${step.nodeId}`,
			runId: run.runId,
			span: { of: "inner", stepId: step.id, what: "gate", from: wait.from },
			parent: spanKey,
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
		point(records, "gateWait", ms / 1000, labels);
	}
	for (const sleep of end.sleeps) {
		records.push({
			kind: "span",
			name: `${SPAN.wait} ${sleep.reason}`,
			runId: run.runId,
			span: { of: "inner", stepId: step.id, what: "wait", from: sleep.from },
			parent: spanKey,
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
		point(records, "agentDuration", seconds, {
			...labels,
			[ATTR.operation]: OPERATION.agent,
			[ATTR.provider]: provider,
			[ATTR.agentName]: step.nodeId,
			[ATTR.workflowName]: workflowName(run),
			...who,
			...failed,
		});
	} else {
		point(records, "stepDuration", seconds, {
			...labels,
			[ATTR.outcome]: end.outcome,
			...who,
			...failed,
		});
	}
	if (end.first && step.visit > 1) point(records, "retries", 1, labels);
	// A step a person reopens lands again when it ends again: a counter only adds.
	if (end.landing) {
		point(records, "ladderRung", 1, {
			...labels,
			...landingAttributes(end.landing),
		});
	}
	spent(records, run, step, end, deviceId);
}

/**
 * What a step spent: its cost and its sessions' tokens. The only points
 * a test run writes.
 */
function spent(
	records: RunRecord[],
	run: TracedRun,
	step: Step,
	end: StepEnd,
	deviceId: string,
): void {
	const labels = {
		...runMetricAttributes(run),
		[ATTR.nodeKind]: step.nodeType,
		[ATTR.deviceId]: step.deviceId ?? deviceId,
	};
	const rung = step.rung ? { [ATTR.ladderRung]: step.rung } : {};
	if (end.costUsd !== null && end.costUsd > 0) {
		point(records, "cost", end.costUsd, {
			...labels,
			...rung,
			[ATTR.costBasis]: end.costBasis,
		});
	}
	for (const session of end.sessions) {
		const sessionProvider = providerOf(session.harness);
		const tokenLabels = {
			...labels,
			[ATTR.agent]: session.harness,
			...(session.model ? { [ATTR.model]: session.model } : {}),
			[ATTR.operation]: OPERATION.agent,
			[ATTR.provider]: sessionProvider,
			[ATTR.tokenModality]: TOKEN_MODALITY.unknown,
		};
		if (session.costUsd !== null && session.costUsd > 0) {
			point(records, "cost", session.costUsd, {
				...labels,
				...rung,
				[ATTR.agent]: session.harness,
				...(session.model ? { [ATTR.model]: session.model } : {}),
				[ATTR.costBasis]: session.costBasis,
			});
		}
		const { input, output, cacheRead, cacheWrite } = session.tokens;
		if (input > 0) point(records, "inputTokens", input, tokenLabels);
		if (output > 0) point(records, "outputTokens", output, tokenLabels);
		if (cacheRead > 0) {
			point(records, "cacheReadTokens", cacheRead, tokenLabels);
		}
		if (cacheWrite > 0) {
			point(records, "cacheWriteTokens", cacheWrite, tokenLabels);
		}
	}
}

function runEnded(
	records: RunRecord[],
	run: TracedRun,
	end: TracedRunEnd,
	deviceId: string,
): void {
	const from = end.first ? (run.startedAt ?? end.openedAt) : end.openedAt;
	const failed = end.status === "failed";
	records.push({
		kind: "span",
		name: `${OPERATION.workflow} ${workflowName(run)}`,
		runId: run.runId,
		span: end.first
			? { of: "run", runId: run.runId }
			: { of: "later", id: run.runId, seq: end.seq },
		parent: end.first ? null : { of: "run", runId: run.runId },
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
	const labels = { ...runMetricAttributes(run), [ATTR.deviceId]: deviceId };
	point(records, "workflowDuration", Math.max(end.at - from, 0) / 1000, {
		...labels,
		[ATTR.workflowName]: workflowName(run),
		[ATTR.operation]: OPERATION.workflow,
		[ATTR.status]: end.status,
		...(failed ? { [ATTR.errorType]: errorTypeOf(end.endReason) } : {}),
	});
	point(records, "runOutcome", 1, {
		...labels,
		[ATTR.status]: end.status,
		[ATTR.neededYou]: end.neededYou,
	});
}

function scored(
	records: RunRecord[],
	run: TracedRun,
	fact: Extract<RecordedFact, { kind: "scored" }>,
	deviceId: string,
): void {
	const labels = { ...runMetricAttributes(run), [ATTR.deviceId]: deviceId };
	if (!OWN_SCORES.has(fact.score)) {
		point(records, "flowMetric", fact.value, {
			...labels,
			[ATTR.flowMetricName]: fact.score,
		});
		return;
	}
	point(records, "score", fact.value, {
		...labels,
		[ATTR.score]: fact.score,
		...(fact.label ? { [ATTR.scoreLabel]: fact.label } : {}),
		...(fact.by ? { [ATTR.scoreBy]: fact.by } : {}),
	});
}

/**
 * What one landed fact of `run` writes, in order. `deviceId` is this
 * computer's Device: the Walker of the runs, and where a step without one
 * ran. A fact whose step or end the run does not have writes nothing.
 */
export function recordsOf(
	run: TracedRun,
	fact: RecordedFact,
	deviceId: string,
): RunRecord[] {
	const records: RunRecord[] = [];
	if (fact.kind === "step-ended") {
		const step = run.steps.find((s) => s.id === fact.stepId);
		const end = step?.ends.find((e) => e.seq === fact.seq);
		if (!step || !end) return records;
		// A test run counts only in the spend (ADR 27): no span, no other point.
		if (run.test) spent(records, run, step, end, deviceId);
		else stepEnded(records, run, step, end, deviceId);
	} else if (run.test) {
		return records;
	} else if (fact.kind === "run-ended") {
		const end = run.ends.find((e) => e.seq === fact.seq);
		if (end) runEnded(records, run, end, deviceId);
	} else {
		scored(records, run, fact, deviceId);
	}
	return records;
}
