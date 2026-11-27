import { randomUUID } from "node:crypto";
import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	applyVariableWrites,
	type FlowNode,
	type TemplateContext,
	type VariableResult,
} from "@nightshift/flows";
import { dataProblem } from "@nightshift/flows/json-schema";
import {
	type DerivedStep,
	type FlowScore,
	flowScores,
	type Hold,
	knowledgeUseEvent,
	type RunEndReason,
	type RunState,
	type Scope,
	type StepBudget,
	type StepOutcome,
	type StepOutputs,
	scopeKey,
} from "../../log";
import { deriveBudgetSpend, deriveWorktrees, pullRequestOf } from "../../read";
import { isTestRun } from "../../run-status";
import { keptNames } from "../../variables";
import { outrun, placeOf } from "../branches";
import {
	climbCommand,
	climbNext,
	climbOutputs,
	climbValues,
	stepRung,
} from "../cascade";
import {
	emit,
	keptFlowOf,
	STOP_AFTER_STEP_REASON,
	STOP_TIME_REASON,
	type StepContext,
	stopAtOf,
	templateContext,
} from "../context";
import { keepShapes, stepShapes } from "../data";
import { budgetPassed, runBudget } from "../policy";
import { positionOf } from "../position";
import { parkCommand, route, scopeOf } from "../route";
import type { RunStateValues } from "../state";
import { haltMessages } from "./abort";
import { worktreeOn } from "./ready-device";
import type {
	AbortReason,
	BeginStep,
	OpenStep,
	StepHandle,
	StepStart,
} from "./step-handle";

/**
 * The open and the close of a step (`beginStep`): the entry checks of a
 * new visit, `StepStarted` or `StepReopened`, the transcript and the
 * timers, and the `OpenStep` whose `end` writes `StepEnded` with the
 * writes of the node, its kept values, its shapes and its scores.
 */

/** The node types whose data may hold `scores`: the flow's own metrics (Q32). */
const SCORED_TYPES: ReadonlySet<FlowNode["type"]> = new Set([
	"command",
	"agent",
	"value",
]);

/**
 * The scores in the data of a Command, an Agent or a Value step
 * (`flowScores`), as `{"scores": {"found": 12}}`: one `Scored` each on the
 * step, after its `StepEnded`. One the step cannot keep is a warning
 * (`score`), never a failed step. The data of any other node is never read.
 */
async function dataScores(
	step: StepHandle,
	node: FlowNode,
	outputs: StepOutputs,
): Promise<FlowScore[]> {
	if (!SCORED_TYPES.has(node.type)) return [];
	const { scores, refused } = flowScores(outputs.data);
	for (const message of refused) await step.warn("score", message);
	return scores;
}

/**
 * Opens a step of `node` and returns what the node needs. For a new visit
 * it first runs the walk's entry checks, in this order, and parks the run
 * when one fires: a stop of the run (stopped, no reason), a stop after the
 * running step, the stop time (both stopped, with today's reasons), and the
 * step cap and the run's budget (failed, with why; the budget also lands a
 * `budget` warning). A continued or reopened step skips
 * them all: it is already in the log, and a stop must end it there (the old
 * walk had no entry check for one). It then writes the `step` row and
 * `StepStarted` (with the transcript path, the command log path, the
 * scope and the time budget), or `StepReopened` for a reopen (with the
 * time budget), and opens the transcript and the timers. Exactly
 * `runStep`'s scaffolding in the old engine. It asks
 * `ctx.placement.deviceFor` for the step's Device first, or, for a step
 * that follows the work (`NodeKind.followsWork`), takes the Device that
 * has the run's work now; `StepStarted` names it.
 *
 * `runState` is the run state as the caller read it on entry; without it
 * it is read here.
 */
export async function beginStep(
	ctx: StepContext,
	node: FlowNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	start: StepStart = { kind: "new" },
	runState?: RunState,
): Promise<BeginStep> {
	const runId = ctx.run.id;
	const scope = scopeOf(config);
	// Asked once per step: the body works on this Device, and a new step
	// records it. It works for the run: its calls read the run's Project
	// secrets (ADR 13).
	let device = ctx.placement.deviceFor(node, ctx.run);
	const logged = runState ?? (await ctx.log.state(runId));
	// A step that only reads the run's copy goes where the copy is: a
	// Hand-off would refuse what a step there did not commit.
	if (ctx.kindOf(node).followsWork(node) && !logged.runFolder) {
		const { holder } = deriveWorktrees(logged, ctx.run);
		device = ctx.placement.deviceById(holder, ctx.run);
	}
	// The kind says which timers a step has: a Gate waits as long as it
	// must, a Wait node keeps its own deadline across its sleeps, and only an
	// Agent step has an idle clock (its own, else the policy's). The log
	// keeps the same limits, so they hold when the timers do not
	// (`deriveStepClocks`).
	// A stand-in of a test run gives its output at once: it has no timers.
	const standIn = start.kind === "new" ? start.standIn : undefined;
	const { timeoutMinutes, idleMinutes } =
		start.kind === "new" && (start.untimed || standIn)
			? { timeoutMinutes: undefined, idleMinutes: undefined }
			: ctx.kindOf(node).timeBudget(node, ctx.policy());
	const budget: StepBudget = {
		...(timeoutMinutes ? { timeoutMs: timeoutMinutes * ctx.minuteMs } : {}),
		...(idleMinutes !== undefined
			? { idleMs: idleMinutes * ctx.minuteMs }
			: {}),
	};
	const parked = (
		status: "failed" | "stopped",
		reason: string | null,
		endReason: RunEndReason,
	) => ({
		kind: "parked" as const,
		command: parkCommand({
			node,
			status,
			reason,
			endReason,
			step: null,
			atStopTime: endReason === "stop_time",
		}),
	});

	let stepId: string;
	let path: string;
	let visit: number;
	let existing: DerivedStep | null = null;
	if (start.kind === "new") {
		// A branch another branch outran starts nothing more.
		if (outrun(ctx, state, node, config)) {
			return {
				kind: "parked",
				command: new Command({ update: { pending: { [node.id]: null } } }),
			};
		}
		// Only a new visit parks before its step: a continued or reopened step
		// enters the node body with the aborted signal, so it ends `stopped`
		// with its session and a later resume can reopen it.
		if (ctx.signal().aborted) {
			return parked("stopped", null, "stopped_by_person");
		}
		if (logged.stopAfterStep) {
			return parked("stopped", STOP_AFTER_STEP_REASON, "stopped_by_person");
		}
		const stopAt = stopAtOf(state, config);
		if (stopAt !== null && ctx.now() >= stopAt) {
			return parked("stopped", STOP_TIME_REASON, "stop_time");
		}
		const limit = ctx.policy().maxSteps ?? ctx.settings().maxStepsPerRun;
		if (logged.stepsSinceWalk >= limit) {
			return parked(
				"failed",
				`The run reached the limit of ${limit} steps before node "${node.id}". Resume it to continue.`,
				"guard.max_steps",
			);
		}
		const budgetUsd = runBudget(ctx);
		if (budgetUsd !== null) {
			const spent = deriveBudgetSpend(logged).usd;
			if (spent >= budgetUsd) {
				const reason = budgetPassed(budgetUsd, spent, node.id);
				await ctx.log.append({
					type: "RunWarned",
					runId,
					payload: { kind: "budget", message: reason },
				});
				return parked("failed", reason, "guard.budget");
			}
		}
		stepId = randomUUID();
		path = ctx.log.files(runId).transcript(stepId);
		visit = positionOf(state, logged, scope).nextVisit(node);
		const logPath =
			!standIn && ctx.kindOf(node).logsCommandOutput(node)
				? ctx.log.files(runId).commandLog(stepId)
				: null;
		// Its rung, from the node with the cascade: a tier's node has none.
		// A stand-in is on no rung: nobody worked or decided.
		const rung = standIn ? null : stepRung(start.climb?.root ?? node, state);
		// The log writes the step's row with its event, in one batch: a stop
		// lands before or after both. `deviceId` is the Device the step runs
		// on (its Placement), not the Walker. A stand-in runs on none.
		await ctx.log.append({
			type: "StepStarted",
			runId,
			stepId,
			payload: {
				nodeId: node.id,
				nodeType: node.type,
				visit,
				transcriptPath: path,
				logPath,
				scope,
				...(standIn ? { test: standIn } : { deviceId: device.id }),
				...(rung ? { rung } : {}),
				...budget,
			},
		});
	} else {
		existing = logged.steps.get(start.stepId) ?? null;
		if (!existing) throw new Error(`Step not found: ${start.stepId}`);
		stepId = existing.id;
		visit = existing.visit;
		// A step that moved goes on where it moved to: its session and its
		// work are there.
		if (existing.moved && existing.deviceId) {
			device = ctx.placement.deviceFor(node, ctx.run, existing.deviceId);
		}
		if (start.kind === "reopen") {
			await ctx.log.append({
				type: "StepReopened",
				runId,
				stepId,
				payload: { prompt: start.prompt, ...budget },
			});
		}
	}
	const changed = () =>
		ctx.bus.publish(runId, { kind: "step-changed", stepId });
	if (!(start.kind === "continue" && start.quiet)) {
		changed();
		emit(config, {
			type: "step-started",
			stepId,
			nodeId: node.id,
			visit,
			reopened: start.kind !== "new",
		});
	}

	const recorder = await ctx.recorders.open(runId, stepId);

	// The step's own signal: a stop of the run, the node's time budget, or
	// no activity for too long.
	const stepController = new AbortController();
	const runSignal = ctx.signal();
	const onStop = () => stepController.abort("stopped" satisfies AbortReason);
	if (runSignal.aborted) onStop();
	else runSignal.addEventListener("abort", onStop, { once: true });
	const timer = timeoutMinutes
		? setTimeout(
				() => stepController.abort("timeout" satisfies AbortReason),
				timeoutMinutes * ctx.minuteMs,
			)
		: undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const touch = () => {
		if (idleMinutes === undefined || stepController.signal.aborted) return;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(
			() => stepController.abort("idle" satisfies AbortReason),
			idleMinutes * ctx.minuteMs,
		);
	};
	touch();
	// A step of a branch stops when another branch wins a `first` Join.
	const unrace = placeOf(ctx.flow, node.id)
		? ctx.races.running(scopeKey(scope), node.id, () =>
				stepController.abort("outrun" satisfies AbortReason),
			)
		: () => {};

	// A try of a cascade: what its templates read, and what every end adds.
	const { climb } = start;
	const climbed = climb ? climbOutputs(climb.root, climb.at) : null;

	let closed = false;
	const leaveOpen = () => {
		if (closed) return;
		closed = true;
		recorder.close();
		clearTimeout(timer);
		clearTimeout(idleTimer);
		runSignal.removeEventListener("abort", onStop);
		unrace();
	};

	const handle: OpenStep = {
		stepId,
		visit,
		device,
		// The run's worktree on this Device; a Hand-off sets it again.
		worktree: worktreeOn(ctx, logged, device) ?? ctx.run.worktreePath,
		existing,
		runState: logged,
		tctx: {
			...withServiceTails(
				ctx,
				templateContext(ctx, state, config),
				logged.holds,
				scope,
			),
			...(climb ? { cascade: climbValues(climb.root, climb.at) } : {}),
		},
		signal: stepController.signal,
		opened: start.kind,
		record(sessionId, stepEvent) {
			const entry = recorder.record(sessionId, stepEvent);
			emit(config, { type: "transcript", entry });
		},
		touch,
		halt(reason, message) {
			if (stepController.signal.aborted) return;
			haltMessages.set(stepController.signal, message);
			stepController.abort(reason satisfies AbortReason);
		},
		async warn(kind, message) {
			await ctx.log.append({
				type: "RunWarned",
				runId,
				stepId,
				payload: { kind, message },
			});
			changed();
		},
		async usedKnowledge(sessionId, { projectId, use }) {
			await ctx.log
				.append({
					...knowledgeUseEvent(projectId, use, "step"),
					runId,
					stepId,
					sessionId,
				})
				.then(changed, (error) => {
					console.warn("A use of the knowledge was not logged:", error);
				});
		},
		async session(started) {
			const sessionId = randomUUID();
			// The log writes the session's row with its event.
			await ctx.log.append({
				type: "SessionStarted",
				runId,
				stepId,
				sessionId,
				payload: started,
			});
			changed();
			return {
				id: sessionId,
				async assigned(harnessSessionId, model) {
					await ctx.log.append({
						type: "HarnessSessionAssigned",
						runId,
						stepId,
						sessionId,
						payload: { harnessSessionId, model },
					});
					changed();
				},
				async spent(payload) {
					await ctx.log.append({
						type: "SessionUsage",
						runId,
						stepId,
						sessionId,
						payload,
					});
					changed();
				},
				async ended(payload) {
					await ctx.log.append({
						type: "SessionEnded",
						runId,
						stepId,
						sessionId,
						payload,
					});
				},
			};
		},
		async end(ended, endOutputs, endError, extra) {
			leaveOpen();
			// The node's writes, before `StepEnded`: a write that does not fit
			// ends the step `error` instead, so the run parks and a person
			// can fix the flow and resume.
			let outcome = ended;
			let outputs = climbed ? { ...endOutputs, ...climbed } : endOutputs;
			let error = endError;
			const written = extra?.skipWrites
				? ({ ok: true, values: {} } as const)
				: await writeVariables(ctx, node, handle.tctx, outcome, outputs);
			if (!written.ok) {
				outcome = "error";
				outputs = { ...outputs, outcome };
				error = written.error;
			}
			const variables =
				written.ok && Object.keys(written.values).length > 0
					? written.values
					: undefined;
			// A test run keeps nothing that lasts (ADR 27): no kept values, no
			// memory and no shapes. Its steps still read them.
			const lasting = !isTestRun(logged);
			// A write of a kept variable saves it for the next run: the log
			// writes the values `kept` names, in the batch of the step's end.
			const keptFlow = variables && lasting ? keptFlowOf(ctx, scope) : null;
			const keptWritten =
				variables && keptFlow
					? Object.keys(variables).filter((name) =>
							keptNames(ctx.flow).has(name),
						)
					: [];
			// The shapes of the step's data, for a node with no schema yet:
			// the Walker keeps them on the node after the end (`kept-shapes.ts`).
			const shapes =
				extra?.skipWrites || !lasting
					? undefined
					: stepShapes(ctx, node, scope, outcome, outputs);
			// A stand-in's outputs are an earlier step's: it opened nothing.
			const opened = standIn ? null : pullRequestOf(outputs);
			if (opened) {
				await ctx.log.append({
					type: "PullRequestOpened",
					runId,
					payload: { url: opened },
				});
			}
			await ctx.log.append({
				type: "StepEnded",
				runId,
				stepId,
				payload: {
					outcome,
					outputs,
					error,
					...(variables ? { variables } : {}),
					...(keptFlow && keptWritten.length > 0
						? {
								kept: { flowName: keptFlow.flowName, names: keptWritten },
							}
						: {}),
					...(extra?.costUsd !== undefined ? { costUsd: extra.costUsd } : {}),
					...(extra?.costSource !== undefined
						? { costSource: extra.costSource }
						: {}),
					...(written.ok && extra?.guard ? { guard: extra.guard } : {}),
					// The cause a resume reads when it routes the step from the log.
					...(written.ok && extra?.endReason
						? { endReason: extra.endReason }
						: {}),
					...(extra?.handOffFailed
						? { handOffFailed: extra.handOffFailed }
						: {}),
					// A step that ends `error` instead runs again: it saw nothing yet.
					...(written.ok && lasting && extra?.memory
						? { memory: extra.memory }
						: {}),
					...(shapes ? { shapes } : {}),
				},
			});
			if (shapes) await keepShapes(ctx, scope, node, shapes);
			changed();
			emit(config, {
				type: "step-ended",
				stepId,
				nodeId: node.id,
				visit,
				outcome,
			});
			return {
				stepId,
				visit,
				outcome,
				outputs,
				error,
				...(written.ok && extra?.guard ? { guard: extra.guard } : {}),
				// A write that did not fit is the error now: the cause goes with it.
				...(written.ok && extra?.endReason
					? { endReason: extra.endReason }
					: {}),
				...(extra?.harnessSessionId !== undefined
					? { harnessSessionId: extra.harnessSessionId }
					: {}),
				...(variables ? { variables } : {}),
			};
		},
		async endAndGo(outcome, outputs, error, more = {}) {
			const { update, trail, ...extra } = more;
			const next = climb
				? climbNext(climb, { outcome, outputs, error }, trail)
				: null;
			// A climbing try scores nothing: only the try that lands. A
			// stand-in scores nothing either: its data is an earlier step's.
			const scores =
				next || standIn ? [] : await dataScores(handle, node, outputs);
			const end = await handle.end(outcome, outputs, error, {
				...extra,
				...(next ? { skipWrites: true } : {}),
			});
			// After the end, as a Gate's answer: every reader sees the step ended first.
			for (const { score, value } of scores) {
				await ctx.log.append({
					type: "Scored",
					runId,
					stepId,
					payload: { score, value, label: null },
				});
			}
			if (climb && next) return climbCommand(climb.root, end, next);
			return route(ctx, state, node, end, config, update);
		},
		leaveOpen,
	};
	return { kind: "step", step: handle };
}

/**
 * The node's writes to its flow's variables for a step that ends with
 * `outcome` (`applyVariableWrites`): over the step's template context, with
 * the node's own outputs this step's, and a `json` variable held to its
 * schema.
 */
function writeVariables(
	ctx: StepContext,
	node: FlowNode,
	tctx: TemplateContext,
	outcome: StepOutcome,
	outputs: StepOutputs,
): Promise<VariableResult> | VariableResult {
	if (!node.set || node.set.length === 0) return { ok: true, values: {} };
	return applyVariableWrites({
		node,
		variables: ctx.flow.variables ?? [],
		outcome,
		context: { ...tctx, nodes: { ...tctx.nodes, [node.id]: outputs } },
		checkSchema: dataProblem,
	});
}

/**
 * `{{stack.log_tail}}` of a service that runs: the end of its log as it is
 * now, not as it was when the service got ready. Only the services of this
 * flow's scope, by their node.
 */
function withServiceTails(
	ctx: StepContext,
	tctx: TemplateContext,
	holds: readonly Hold[],
	scope: Scope | null,
): TemplateContext {
	const key = scopeKey(scope);
	let nodes: TemplateContext["nodes"] | null = null;
	for (const hold of holds) {
		if (hold.kind !== "service" || scopeKey(hold.scope) !== key) continue;
		const outputs = tctx.nodes[hold.nodeId];
		if (outputs === undefined) continue;
		nodes ??= { ...tctx.nodes };
		nodes[hold.nodeId] = {
			...outputs,
			log_tail: ctx.services.tail(hold.logPath),
		};
	}
	return nodes === null ? tctx : { ...tctx, nodes };
}
