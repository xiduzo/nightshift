import { provedEndReason } from "../end-reason";
import { type EngineEventType, type LoggedEvent, scopeKey } from "../events";
import { closeLast, type Draft, draftOf, emptyState, logged } from "./draft";
import { applySessionEvent } from "./fold-session";
import { applyStepEvent, enterCallers } from "./fold-step";
import { sameService } from "./holds";
import type {
	DerivedStep,
	OpenGateFact,
	RunState,
	SleepFact,
} from "./run-state";

/**
 * The fold of the run state (`run-state.ts`): one event at a time. It
 * decides what an event means for the run. An event of a session or of a
 * step also goes to `fold-session.ts` and `fold-step.ts`.
 */

/** The run state of a run's events (any order: they are folded by seq). */
export function foldRun(events: readonly LoggedEvent[]): RunState {
	let ordered = events;
	for (let i = 1; i < events.length; i++) {
		if ((events[i] as LoggedEvent).seq < (events[i - 1] as LoggedEvent).seq) {
			ordered = [...events].sort((a, b) => a.seq - b.seq);
			break;
		}
	}
	const draft = emptyState();
	const owned = new WeakSet<readonly unknown[]>();
	for (const e of ordered) apply(draft, e, owned);
	return draft;
}

/**
 * The run state after one more event, or null when `e` is not the latest
 * (its seq is not past the state's): the caller folds the log again.
 * `state` itself does not change.
 */
export function nextState(state: RunState, e: LoggedEvent): RunState | null {
	if (e.seq <= state.lastSeq) return null;
	const draft = draftOf(state);
	apply(draft, e);
	return draft;
}

function apply(
	run: Draft,
	e: LoggedEvent,
	owned: WeakSet<readonly unknown[]> = new WeakSet(),
): void {
	run.lastSeq = e.seq;
	if (e.type !== "Scored") run.lastAt = e.at;
	run.runId ??= e.runId;
	switch (e.type) {
		case "RunStarted":
		case "RunResumed":
		case "RunEnded":
			applyRunEvent(run, e);
			settleRun(run);
			return;
		case "RunWarned":
			run.warnings.push(logged(e));
			break;
		case "LeaseTaken":
			run.holds = [
				...run.holds.filter(
					(hold) => !(hold.kind === "lease" && hold.name === e.payload.name),
				),
				{
					kind: "lease",
					name: e.payload.name,
					nodeId: e.payload.nodeId,
					scope: e.payload.scope ?? null,
					section: e.payload.section ?? null,
					ttlMinutes: e.payload.ttlMinutes,
					at: e.at,
				},
			];
			break;
		case "LeaseReleased":
			run.holds = run.holds.filter(
				(hold) => !(hold.kind === "lease" && hold.name === e.payload.name),
			);
			break;
		case "ServiceStarted":
			run.holds = [
				...run.holds.filter((hold) => !sameService(hold, e.payload)),
				{
					kind: "service",
					nodeId: e.payload.nodeId,
					scope: e.payload.scope ?? null,
					section: e.payload.section ?? null,
					deviceId: e.payload.deviceId,
					cwd: e.payload.cwd,
					logPath: e.payload.logPath,
					pid: e.payload.pid,
					startedAt: e.payload.startedAt,
					spec: e.payload.spec,
					at: e.at,
				},
			];
			break;
		case "ServiceStopped":
			run.holds = run.holds.filter((hold) => !sameService(hold, e.payload));
			break;
		case "Scored":
			run.scores.push(logged(e));
			break;
		case "PullRequestOpened":
			run.pullRequest = { url: e.payload.url, at: e.at };
			break;
		case "StopRequested":
			run.stops.push({
				seq: e.seq,
				at: e.at,
				by: e.payload.by ?? null,
				restart: e.payload.restart === true,
				afterStep: false,
			});
			break;
		case "StopAfterStepRequested":
			run.stopAfterStep = true;
			run.stops.push({
				seq: e.seq,
				at: e.at,
				by: "person",
				restart: false,
				afterStep: true,
			});
			break;
		case "StopAfterStepCancelled": {
			run.stopAfterStep = false;
			// A person withdrew it: the run did not stop after all.
			const withdrawn = run.stops.findLastIndex((stop) => stop.afterStep);
			if (withdrawn >= 0) run.stops.splice(withdrawn, 1);
			break;
		}
		case "RunTakenOver":
			run.takeOvers.push(logged(e));
			break;
		case "WorktreeCreated":
			run.worktree = e.payload;
			run.moves.push({ kind: "created", ...logged(e) });
			break;
		case "StepMoved": {
			const moved = e.stepId ? run.steps.get(e.stepId) : undefined;
			if (moved && e.stepId) {
				run.steps.set(e.stepId, {
					...moved,
					deviceId: e.payload.to,
					moved: true,
				});
			}
			break;
		}
		case "HandedOff":
			run.moves.push({ kind: "handed-off", ...logged(e) });
			break;
		case "EdgeTaken": {
			const key = scopeKey(e.payload.scope);
			const scope = e.payload.scope
				? {
						parentStepId: e.payload.scope.parentStepId,
						itemId: e.payload.scope.itemId,
					}
				: null;
			const edges = run.edges.get(key);
			const taken = logged(e);
			run.edges.set(key, {
				scope: edges?.scope ?? scope,
				taken: [...(edges?.taken ?? []), taken],
			});
			run.lastEdge = taken;
			break;
		}
		case "VariablesSet": {
			const key = scopeKey(e.payload.scope);
			run.variables.set(key, {
				...run.variables.get(key),
				...e.payload.values,
			});
			const kept = new Set(e.payload.kept ?? []);
			for (const [name, value] of Object.entries(e.payload.values)) {
				run.variableChanges.push({
					scope: e.payload.scope ?? null,
					name,
					value,
					stepId: null,
					...(kept.has(name) ? { kept: true as const } : {}),
					at: e.at,
				});
			}
			break;
		}
		case "WaitStarted":
			run.wait = logged(e);
			break;
		case "WaitEnded": {
			const ended = run.wait && run.wait.stepId === e.stepId ? run.wait : null;
			if (e.payload.early) {
				run.earlyWakes.push({
					...logged(e),
					reason: ended?.payload.reason ?? null,
				});
			}
			if (ended) run.wait = null;
			break;
		}
	}
	if (e.sessionId) applySessionEvent(run, e, e.sessionId);
	if (e.stepId) applyStepEvent(run, e, e.stepId, owned);
	enterCallers(run, e);
	if (RUN_FACT_EVENTS.has(e.type)) settleRun(run);
}

/**
 * The events after which the run's folded facts (`status`, `gates`,
 * `sleep`) can differ: a run event, an opening or end of a step, a Gate
 * opened, a wait begun or ended. Any other event changes none of them.
 */
const RUN_FACT_EVENTS: ReadonlySet<EngineEventType> = new Set<EngineEventType>([
	"RunStarted",
	"RunResumed",
	"RunEnded",
	"StepStarted",
	"StepReopened",
	"StepEnded",
	"GateOpened",
	"WaitStarted",
	"WaitEnded",
]);

/** The run's folded facts set again from its steps, its wait and its latest run event. */
function settleRun(run: Draft): void {
	run.gates = openGatesOf(run);
	run.gate = run.gates.at(-1) ?? null;
	run.sleep = sleepOf(run);
	run.status = run.end
		? run.end.status
		: !run.latest
			? "interrupted"
			: run.gate
				? "waiting"
				: run.sleep
					? "sleeping"
					: "running";
}

/**
 * Every Gate the run waits at, in the order the steps started: a Gate step
 * that opened since its latest opening and since the latest run event, and
 * has not ended, while the run has not ended.
 */
function openGatesOf(run: Draft): OpenGateFact[] {
	const { latest } = run;
	if (!latest || run.end) return [];
	const gates: OpenGateFact[] = [];
	const asking = (step: DerivedStep) =>
		step.gate !== null &&
		step.gate.openedSeq > step.openedSeq &&
		step.gate.openedSeq > latest.seq;
	// A step that runs, not one that asks or sleeps: its branch still works.
	let branchesWork = false;
	for (const step of run.steps.values()) {
		if (
			step.endedAt === null &&
			!asking(step) &&
			step.id !== run.wait?.stepId
		) {
			branchesWork = true;
		}
	}
	for (const step of run.steps.values()) {
		const { gate } = step;
		if (step.endedAt === null && gate !== null && asking(step)) {
			gates.push({
				stepId: step.id,
				nodeId: step.nodeId,
				visit: step.visit,
				question: gate.question,
				choices: gate.choices,
				urgency: gate.urgency,
				brief: gate.brief,
				lockScreen: gate.lockScreen,
				openedAt: gate.openedAt,
				deadline: gate.deadline,
				form: gate.form,
				branchesWork,
			});
		}
	}
	return gates;
}

/** The wait the run sleeps in (`RunState.sleep`), or null. */
function sleepOf(run: Draft): SleepFact | null {
	const { wait } = run;
	if (!wait?.stepId || !run.latest || run.end) return null;
	const step = run.steps.get(wait.stepId);
	if (!step || step.endedAt !== null) return null;
	return {
		stepId: wait.stepId,
		reason: wait.payload.reason,
		until: wait.payload.until,
		message: wait.payload.message,
		signal: wait.payload.signal ?? null,
		signalKey: wait.payload.signalKey ?? null,
		signalRules: wait.payload.signalRules ?? [],
	};
}

function applyRunEvent(
	run: Draft,
	e: Extract<LoggedEvent, { type: "RunStarted" | "RunResumed" | "RunEnded" }>,
): void {
	// A stop ends the sleep and the Gate's wait, and a resume goes on awake.
	for (const [id, step] of run.steps) {
		const sleeps = closeLast(step.sleeps, e.at);
		const gateWaits = closeLast(step.gateWaits, e.at);
		if (sleeps !== step.sleeps || gateWaits !== step.gateWaits) {
			run.steps.set(id, { ...step, sleeps, gateWaits });
		}
	}
	run.latest = { seq: e.seq, at: e.at };
	run.wait = null;
	if (e.type === "RunEnded") {
		const { status, reason, result } = e.payload;
		run.end = {
			seq: e.seq,
			at: e.at,
			status,
			reason,
			result: result ?? null,
			endReason:
				e.payload.endReason ??
				provedEndReason({ status, reason, result: result ?? null }),
		};
		run.ends.push({ ...logged(e), openedAt: run.walk?.at ?? e.at });
		// An ended run holds nothing: the engine let go of it.
		run.endedHolding = run.holds;
		run.holds = [];
		return;
	}
	run.end = null;
	if (e.type === "RunResumed") run.endedHolding = [];
	run.walk = { seq: e.seq, at: e.at };
	run.stopAfterStep = false;
	run.stepsSinceWalk = 0;
	if (e.type === "RunStarted") {
		run.started ??= logged(e);
		run.runFolder = run.started.payload.runFolder === true;
		run.test = run.started.payload.test ?? null;
		run.stopAt = e.payload.stopAt ?? null;
		run.daemonResumes = 0;
		run.budgetFrom = e.seq;
	} else {
		run.resumes.push(logged(e));
		if (e.payload.clearStopAt) run.stopAt = null;
		const byDaemon = e.payload.by === "daemon";
		run.daemonResumes = byDaemon ? run.daemonResumes + 1 : 0;
		if (!byDaemon) run.budgetFrom = e.seq;
	}
}
