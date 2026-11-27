import { shellQuote } from "@nightshift/agents/harness-facts";
import type { AgentHarness, AgentHarnessName } from "@nightshift/agents/types";
import { Refusal } from "@nightshift/refusal";
import { instant, lastDays } from "@nightshift/time";
import { stepSources } from "../../../../knowledge";
import {
	type DerivedStep,
	type RunRow,
	type RunState,
	sessionCost,
} from "../../../../log";
import {
	type AnsweredGate,
	costFields,
	deriveCalledTraversals,
	deriveLeases,
	deriveServices,
	deriveSteps,
	deriveTraversals,
	inboxOrder,
	lastHarnessSession,
	NIGHT_RANGES,
	type OpenGate,
	type PendingCommand,
	type ProjectRuns,
	parseCalledFlows,
	type RunDetail,
	type RunWalker,
	runDeviceId,
	type runFacts,
	type StepDetail,
	shownRunFlow,
	stepMetrics,
	toSummary,
	waitingSession,
} from "../../../../read";
import { isTestRun, type RunStatus } from "../../../../run-status";
import type { RunViews } from "../../application/ports";

/**
 * The pages of a run that people open, made from its row and its run
 * state: the run page, a step, the counts of a project's runs, the open
 * and the answered Gates. Pure: the adapters of `RunViews` read the rows
 * and the logs, and make every page here, so the shape of a page changes
 * in one file.
 */

/** What a run summary reads from the run state (`runFacts` of `read`). */
export type RunFacts = ReturnType<typeof runFacts>;

/** A Device a run names, as the Replica knows it. */
type RunDevice = RunWalker;

/** What a step that is not in its run says. */
const STEP_NOT_FOUND = "Night Shift cannot find this step of the run.";

/** The take-over facts of the harness of that name, or none. */
export type HarnessOf = (
	name: AgentHarnessName,
) => Pick<AgentHarness, "takeOverCommand"> | undefined;

/** Names a Device by id, as this Replica knows it. */
export type DeviceNamer = (id: string) => RunDevice;

/** The open Gate of a run, as the run log keeps it until its next append. */
export type OpenGateOfRun = NonNullable<RunState["gate"]>;

/**
 * The command a person runs in the worktree to take over the last harness
 * session, from the harness port's `takeOverCommand`. Null when there is
 * none, when the harness is not built, or when it has no command for it.
 */
export function takeOverCommand(
	worktreePath: string,
	last:
		| { harness: AgentHarnessName; harnessSessionId: string }
		| null
		| undefined,
	harnessOf: HarnessOf,
): string | null {
	const command = last
		? harnessOf(last.harness)?.takeOverCommand(last.harnessSessionId)
		: null;
	if (!command) return null;
	return `cd ${shellQuote(worktreePath)} && ${command}`;
}

/** The run's status, or null for a run the log has nothing on. */
export function knownStatus(run: RunState): RunStatus | null {
	return run.lastSeq === Number.NEGATIVE_INFINITY ? null : run.status;
}

/** The Gate a run waits at, kept per run by the log until its next append. */
export const openGate = (run: RunState) => run.gate;

/** Every resume of the run, oldest first. */
function runResumes(run: RunState): RunDetail["resumes"] {
	return run.resumes.map((e) => ({
		at: e.at,
		by: e.payload.by ?? "person",
		nodeId: e.payload.nodeId,
		reason: e.payload.reason ?? null,
		action: e.payload.action ?? "resume",
	}));
}

/**
 * The note a person sent with the answer to one wait of a Gate: the
 * `note` output of the opening the wait closed. Null when it is empty,
 * when nobody answered, or when the deadline chose (then Night Shift
 * wrote the note).
 */
function personNote(
	step: DerivedStep,
	wait: DerivedStep["gateWaits"][number],
): string | null {
	if (wait.answeredBy !== "person") return null;
	const note = step.openings[wait.opening]?.end?.payload.outputs.note;
	return typeof note === "string" && note.trim() !== "" ? note : null;
}

/** A Device this Replica knows nothing of: a name is all it lacks. */
const unnamed = (id: string): RunDevice => ({
	id,
	name: null,
	thisDevice: false,
});

/** A Walker the Replica knows nothing of: a name is all it lacks. */
export const walkerOf = (
	walkers: Map<string, RunWalker>,
	id: string,
): RunWalker => walkers.get(id) ?? { id, name: null, thisDevice: false };

/**
 * A step as the run and its stream show it: without the prompts and the
 * elements of its items (`toStepDetail`).
 */
export function toStepSummary(
	derived: DerivedStep,
	deviceOf?: DeviceNamer,
): RunDetail["steps"][number] {
	return {
		id: derived.id,
		nodeId: derived.nodeId,
		nodeType: derived.nodeType,
		visit: derived.visit,
		startedAt: derived.startedAt,
		endedAt: derived.endedAt,
		outcome: derived.outcome,
		outputs: derived.outputs,
		error: derived.error,
		scope: derived.scope,
		items: derived.items.map((item) => ({
			id: item.facts.id,
			title: item.facts.title,
			url: item.facts.url,
			state: item.state,
			branch: item.branch,
			baseBranch: item.baseBranch,
			startedAt: item.startedAt,
			endedAt: item.endedAt,
			reason: item.reason,
		})),
		sessions: derived.sessions.map((s) => ({
			id: s.id,
			harnessSessionId: s.harnessSessionId,
			createdAt: s.startedAt,
			outcome: s.ending?.outcome ?? null,
			error: s.ending?.error ?? null,
			costUsd: s.ending?.costUsd ?? s.spent?.costUsd ?? null,
			costEstimated: sessionCost(s).estimated,
		})),
		...costFields(derived.cost),
		device:
			derived.deviceId === null
				? null
				: (deviceOf?.(derived.deviceId) ?? {
						id: derived.deviceId,
						name: null,
						thisDevice: false,
					}),
		gate: derived.gate
			? {
					question: derived.gate.question,
					choices: derived.gate.choices,
					openedAt: derived.gate.openedAt,
					deadline: derived.gate.deadline,
					...(derived.gate.form ? { form: derived.gate.form } : {}),
				}
			: null,
		sleeps: derived.sleeps.map(({ from, to }) => ({ from, to })),
		metrics: stepMetrics(derived),
		sources: stepSources(derived.knowledge),
		...(derived.test ? { test: derived.test } : {}),
		...(derived.pinnedFrom ? { pinnedFrom: derived.pinnedFrom } : {}),
		...handOffOf(derived),
	};
}

/** The Hand-off that failed the step's latest end, when one did. */
function handOffOf(derived: DerivedStep) {
	const failed = derived.openings.at(-1)?.end?.payload.handOffFailed;
	return failed ? { handOffFailed: failed } : {};
}

/** A step with the prompt of each session and the element of each item: what a person opens. */
export function toStepDetail(
	derived: DerivedStep,
	deviceOf?: DeviceNamer,
): StepDetail {
	const summary = toStepSummary(derived, deviceOf);
	return {
		...summary,
		sessions: summary.sessions.map((session, i) => ({
			...session,
			prompt: derived.sessions[i]?.prompt ?? "",
		})),
		items: summary.items.map((item, i) => ({
			...item,
			value: derived.items[i]?.facts.value ?? null,
		})),
	};
}

/** One step of a run, or "not found". */
export function stepOf(steps: readonly DerivedStep[], stepId: string) {
	const step = steps.find((s) => s.id === stepId);
	if (!step) throw new Refusal("not-found", STEP_NOT_FOUND);
	return step;
}

/**
 * Everything the run page shows: the summary, the flows, the steps, the
 * edges, the resumes. `facts` are `runFacts` of `run`, as the run log
 * keeps them (`RunLog.derive`).
 */
export function toRunDetail(
	row: RunRow,
	run: RunState,
	facts: RunFacts,
	harnessOf: HarnessOf,
	names: ReadonlyMap<string, string>,
	walker: RunWalker,
	commands: PendingCommand[] = [],
	deviceOf?: DeviceNamer,
): RunDetail {
	const device = deviceOf?.(runDeviceId(row)) ?? walker;
	// A run walked or placed elsewhere: its worktree is not on this computer.
	const last =
		walker.thisDevice && device.thisDevice ? lastHarnessSession(run) : null;
	const summary = toSummary(row, facts, names, walker, device);
	return {
		...summary,
		...shownRunFlow(row),
		calledFlows: parseCalledFlows(row),
		flowRevision: row.flowRevision,
		steps: deriveSteps(run).map((step) => toStepSummary(step, deviceOf)),
		// Edges of the top-level flow; a called flow's edges count per scope.
		traversals: deriveTraversals(run),
		calledTraversals: deriveCalledTraversals(run),
		takeOverCommand: takeOverCommand(summary.worktreePath, last, harnessOf),
		resumes: runResumes(run),
		resumeStepId: waitingSession(run)?.id ?? null,
		commands,
		variables: [...run.variableChanges],
		leases: deriveLeases(run),
		services: deriveServices(run),
		handOffs: handOffsOf(run).map((e) => ({
			at: e.at,
			stepId: e.stepId,
			from: deviceOf?.(e.payload.from) ?? unnamed(e.payload.from),
			to: deviceOf?.(e.payload.to) ?? unnamed(e.payload.to),
			commit: e.payload.commit,
		})),
	};
}

/** The run's `HandedOff`s, oldest first. */
export function handOffsOf(run: RunState) {
	return run.moves.flatMap((move) =>
		move.kind === "handed-off" ? [move] : [],
	);
}

/** The Devices the run page of a run names: its Walker, its Device, its steps' and its hand-offs'. */
export function devicesOfRun(row: RunRow, state: RunState) {
	return [
		row.walkerId,
		runDeviceId(row),
		...deriveSteps(state).map((s) => s.deviceId),
		...handOffsOf(state).flatMap((e) => [e.payload.from, e.payload.to]),
	];
}

/**
 * Where a run is and what it does, cheap: its status, when it wakes, and
 * whether this computer walks it or runs its steps. `self` is the run
 * log's Walker id, `deviceId` this computer's Device id.
 */
export function runHereOf(
	runId: string,
	row: Pick<RunRow, "walkerId" | "deviceId">,
	facts: RunFacts,
	self: string,
	deviceId: string,
): NonNullable<Awaited<ReturnType<RunViews["runHere"]>>> {
	const here = (id: string) => id === self || id === deviceId;
	return {
		id: runId,
		status: facts.status,
		wakeAt: facts.wakeAt,
		waitReason: facts.waitReason,
		walkedHere: here(row.walkerId),
		stepsHere: here(runDeviceId(row)),
	};
}

/** The day ranges of the dashboard: the first day of each, on the reader's clock. */
export type ProjectRunsRead = { now: number; timeZone: string };

/**
 * How the runs of each project of a Space stand, by project id, from its
 * runs newest first and their facts. A project without runs is not in it.
 * A test run counts in `total` and `statuses`, as the run list shows it,
 * and in `tests`. The day ranges leave it out, as the dashboard does.
 */
export function countProjectRuns(
	rows: readonly Pick<RunRow, "id" | "projectId" | "title" | "createdAt">[],
	facts: ReadonlyMap<string, RunFacts>,
	read: ProjectRunsRead,
): Map<string, ProjectRuns> {
	// The first day of each range, as the dashboard counts them.
	const ranges = NIGHT_RANGES.map((days) => ({
		days,
		first: lastDays(days, read.now, read.timeZone)[0] ?? read.now,
	}));
	const counts = new Map<string, ProjectRuns>();
	for (const row of rows) {
		let counted = counts.get(row.projectId);
		if (!counted) {
			// Newest first: the first row of a project is its last run.
			counted = {
				total: 0,
				statuses: {},
				last: {
					id: row.id,
					title: row.title,
					createdAt: instant(row.createdAt),
				},
				nextWakeAt: null,
				nights: ranges.map(({ days }) => ({
					nights: days,
					total: 0,
					statuses: {},
				})),
			};
			counts.set(row.projectId, counted);
		}
		const fact = facts.get(row.id);
		if (!fact) continue;
		counted.total += 1;
		counted.statuses[fact.status] = (counted.statuses[fact.status] ?? 0) + 1;
		const createdAt = instant(row.createdAt);
		if (isTestRun(fact)) {
			const tests = counted.tests ?? {};
			tests[fact.status] = (tests[fact.status] ?? 0) + 1;
			counted.tests = tests;
		} else {
			ranges.forEach(({ first }, index) => {
				const range = counted.nights?.[index];
				if (!range || createdAt < first) return;
				range.total += 1;
				range.statuses[fact.status] = (range.statuses[fact.status] ?? 0) + 1;
			});
		}
		if (
			fact.wakeAt !== null &&
			(counted.nextWakeAt === null || fact.wakeAt < counted.nextWakeAt)
		) {
			counted.nextWakeAt = fact.wakeAt;
		}
	}
	return counts;
}

/** A run of a Space with the name of its project, as the Gates name it. */
export type RunOfProject = { run: RunRow; projectName: string };

/**
 * The open Gates of these runs in the inbox order. `open`: the Gate of
 * each run that waits at one. `pending`: the Commands that wait for the
 * Walker of each run walked elsewhere.
 */
export function openGatesOf(
	rows: readonly RunOfProject[],
	open: ReadonlyMap<string, OpenGateOfRun | null>,
	walkers: Map<string, RunWalker>,
	pending: ReadonlyMap<string, PendingCommand[]>,
): OpenGate[] {
	const gates: OpenGate[] = [];
	for (const { run: row, projectName } of rows) {
		const gate = open.get(row.id);
		if (!gate) continue;
		const walker = walkerOf(walkers, row.walkerId);
		// An answer on its way to another Walker, or one that waits for
		// this Walker's drive (`AnswerQueued`).
		const answerPending =
			gate.answerQueued ||
			(pending.get(row.id) ?? []).some((c) => c.kind === "gate.resolve");
		gates.push({
			spaceId: row.spaceId,
			runId: row.id,
			runTitle: row.title,
			flowName: row.flowName,
			projectId: row.projectId,
			projectName,
			stepId: gate.stepId,
			nodeId: gate.nodeId,
			question: gate.question,
			choices: gate.choices,
			urgency: gate.urgency,
			brief: gate.brief,
			lockScreen: gate.lockScreen,
			openedAt: gate.openedAt,
			deadline: gate.deadline,
			form: gate.form,
			walker,
			answerPending,
			answerDropped: gate.answerDropped,
			branchesWork: gate.branchesWork,
		});
	}
	return inboxOrder(gates);
}

/** What the answered Gates read of a run: its steps, and its status and result. */
export function answeredFacts(state: RunState) {
	return {
		steps: deriveSteps(state),
		run: { status: state.status, result: state.end?.result ?? null },
	};
}

/**
 * The Gates of these runs that closed after `since`, newest first: one per
 * wait, with the question it asked and the option it took.
 */
export function answeredGatesOf(
	rows: readonly RunOfProject[],
	derived: ReadonlyMap<string, ReturnType<typeof answeredFacts>>,
	since: number,
): AnsweredGate[] {
	const gates: AnsweredGate[] = [];
	for (const { run: row, projectName } of rows) {
		const facts = derived.get(row.id);
		if (!facts) continue;
		for (const step of facts.steps) {
			for (const wait of step.gateWaits) {
				if (wait.to === null || wait.to < since) continue;
				gates.push({
					spaceId: row.spaceId,
					runId: row.id,
					runTitle: row.title,
					flowName: row.flowName,
					projectId: row.projectId,
					projectName,
					stepId: step.id,
					nodeId: step.nodeId,
					question: wait.question,
					choices: wait.choices,
					urgency: wait.urgency,
					brief: wait.brief,
					openedAt: wait.from,
					closedAt: wait.to,
					answeredBy: wait.answeredBy,
					answer: wait.answer,
					note: personNote(step, wait),
					run: facts.run,
				});
			}
		}
	}
	return gates.sort(
		(a, b) =>
			b.closedAt - a.closedAt ||
			a.runId.localeCompare(b.runId) ||
			a.stepId.localeCompare(b.stepId),
	);
}
