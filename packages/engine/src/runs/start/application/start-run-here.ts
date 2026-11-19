import type { Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { StartRunInput } from "../../../contract";
import type { Device, RunFolder, Worktree } from "../../../device";
import type { resolveInputs, runFolderOn } from "../../../graph";
import type {
	EnginePayloads,
	RunPlan,
	RunTrigger,
	runDueAt,
} from "../../../log";
import type { Projects } from "../../../projects";
import type { RunSummary } from "../../../read";
import type { StartHolds, wireWalk } from "../../walk";
import {
	preparedRun,
	refuseBaseOfRunFolder,
	refuseDevice,
} from "../domain/prepared-run";
import { checkServiceDevices, type Works } from "../domain/service-devices";
import { beforeDeadline, START_TOO_LONG } from "../domain/start-deadline";
import { checkTestRun, refuseTestStart, resolvePins } from "../domain/test-run";
import type { NewRuns, RunPlanner, Starters } from "./ports";

/** The walk's ports, as `wireWalk` builds them. */
type Walk = ReturnType<typeof wireWalk>;

/** A new run as its row and its `RunStarted` record it: what `NewRuns.started` writes in one batch. */
export type NewRun = {
	id: string;
	spaceId: string;
	projectId: string;
	flowName: string | null;
	flow: Flow;
	calledFlows: Record<string, Flow>;
	flowRevision: string | null;
	calledFlowRevisions: Record<string, string>;
	title: string;
	/** Where its worktree is. "" until its Device makes it. */
	worktreePath: string;
	branch: string;
	baseRef: string;
	/** This computer: the Walker of the run. */
	walkerId: string;
	/** The run's plan: the walk reads it, and decides nothing again. */
	plan: RunPlan;
	/** What `RunStarted` says. */
	started: EnginePayloads["RunStarted"];
};

export type StartRunHerePorts = {
	projects: Pick<Projects, "find">;
	planner: Pick<RunPlanner, "plan" | "misfit">;
	runs: NewRuns;
	starters: Starters;
	turns: Pick<Walk["turns"], "take">;
	facts: Pick<Walk["facts"], "append" | "walkerId">;
	holds: Pick<StartHolds, "start">;
	/** The time now (epoch ms). */
	now(): number;
	/** A new run's id: the wire makes it. */
	newRunId(): string;
	/** How long a start may take before it gives up (`START_DEADLINE_MS`). */
	deadlineMs: number;
	/** The pure rules of the walk and the log that the start applies. */
	rules: {
		works: Works;
		resolveInputs: typeof resolveInputs;
		runFolderOn: typeof runFolderOn;
		dueAt: typeof runDueAt;
	};
};

/** A start this computer walks: the run's Space, what it starts, and what started it. */
export type StartRunHere = {
	spaceId: string;
	input: StartRunInput;
	trigger: RunTrigger;
};

/**
 * Starts a run that this computer walks, in the Space's start hold. The
 * run goes wherever its steps run: the plan names the Run's Device.
 *
 * All of it is the start's Turn (`turns.take`): the slot is held before
 * the first await, so two starts cannot both pass the run cap, and a stop
 * that comes meanwhile waits for the walk to begin. With the slot held,
 * and before its deadline, it resolves a test run's pins, plans the run,
 * checks it (`prepared-run.ts`), has the run's Device make the worktree
 * (or the run folder of a project without a folder, ADR 22), writes the
 * run's row and its `RunStarted` in one batch, then `WorktreeCreated` and
 * what the run warns about. An offline Run's Device makes the worktree
 * when it is back: until then the row keeps the base the person asked
 * for, and no branch (ADR 1, decision 11).
 *
 * Refuses what the start hold, the test run, the plan, the checks, the
 * Device and the run cap refuse, and a start that took too long
 * (`START_TOO_LONG`): it writes nothing after its deadline.
 */
export const startRunHere =
	(ports: StartRunHerePorts) =>
	async (request: StartRunHere): Promise<RunSummary> => {
		const { projects, planner, runs, starters, turns, facts, rules } = ports;
		const { spaceId, input, trigger } = request;
		return ports.holds.start(spaceId, async () => {
			refuseTestStart(input, trigger);
			const runId = ports.newRunId();
			let started: { row: NewRunRow; device: Device } | undefined;
			await turns.take(runId, {
				kind: "start",
				prepare: () =>
					beforeDeadline(ports.deadlineMs, async (deadline) => {
						const project = await projects.find(input.projectId);
						// A test run's pins come from this Walker's log, before the
						// plan: it leaves their nodes out (ADR 27).
						const test = await resolvePins(input.test, project, (pinId) =>
							runs.pinned(pinId),
						);
						// Every run has a starter, and the plan names them: the Person
						// who starts it, else this computer's owner (a schedule that
						// names no Person fires here for them), as the Host of the
						// Space knows them.
						const planned = await planner.plan({
							start: input,
							project,
							runId,
							scheduled: trigger.kind === "schedule",
							byPerson: trigger.kind === "manual",
						});
						const startedBy = planned.plan.personId;
						const { device } = planned.run;
						// A project without a folder: the run works in a run folder (ADR 22).
						const runFolder = project.folder === false;
						// The plan left the pinned and skipped nodes out: no Device answers for them.
						if (test) checkTestRun(planned.flow, test);
						refuseBaseOfRunFolder(input, runFolder);
						for (const group of planned.groups) {
							// An offline Device checks each call itself when it is back.
							const misfit =
								group.at.offered || group.at.offline
									? null
									: await planner.misfit(group.nodes, group.at.device);
							refuseDevice(group, misfit, rules.works);
						}
						checkServiceDevices(planned, rules.works);
						const prepared = preparedRun(input, planned, {
							now: ports.now(),
							runFolder,
							works: rules.works,
							resolve: (declared, given) =>
								rules.resolveInputs(declared, given, {
									what: "The flow",
									jsonText: "strict",
								}),
						});
						const authorId = input.startedBy ?? startedBy;
						const author =
							authorId && !runFolder
								? await starters.gitAuthor(authorId)
								: null;
						// The worktree lives on the run's Device. An offline one makes it
						// when it is back: until then the row keeps the base the person
						// asked for, and no branch. So does a run folder.
						const made: Worktree | RunFolder | null = planned.run.offline
							? null
							: runFolder
								? await rules.runFolderOn(device, {
										id: runId,
										projectId: project.id,
									})
								: await device.worktree({
										id: runId,
										projectId: project.id,
										...(input.baseRef !== undefined
											? { baseRef: input.baseRef }
											: {}),
										...(author ? { author } : {}),
									});
						// A base branch the Device could not bring up to date is a warning, not part of the worktree.
						const worktree = made && {
							worktreePath: made.worktreePath,
							branch: made.branch,
							baseRef: made.baseRef,
						};
						// Too late: the person was told it did not start, so it does not.
						if (deadline.aborted) {
							throw new Refusal("unavailable", START_TOO_LONG);
						}
						const walkerId = await facts.walkerId();
						// The row and the event that names it are one batch.
						const row = await runs.started({
							id: runId,
							// The run is in its project's Space, also when the scheduler starts it.
							spaceId: project.spaceId,
							projectId: project.id,
							flowName: prepared.flowName,
							flow: prepared.flow,
							calledFlows: prepared.calledFlows,
							flowRevision: prepared.flowRevision,
							calledFlowRevisions: prepared.calledFlowRevisions,
							title: prepared.title,
							worktreePath: worktree?.worktreePath ?? "",
							branch: worktree?.branch ?? "",
							baseRef: worktree?.baseRef ?? input.baseRef ?? "",
							walkerId,
							plan: planned.plan,
							started: {
								projectId: project.id,
								flowName: prepared.flowName,
								...(prepared.flowRevision !== null
									? { flowRevision: prepared.flowRevision }
									: {}),
								title: prepared.title,
								start: prepared.flow.start,
								stopAt: prepared.stopAt,
								inputs: prepared.inputs,
								trigger,
								startedBy,
								...(runFolder ? { runFolder: true as const } : {}),
								...(test ? { test: test.test } : {}),
							},
						});
						if (worktree) {
							await facts.append({
								type: "WorktreeCreated",
								runId,
								payload: worktree,
							});
						}
						if (made && "warning" in made && made.warning) {
							await facts.append({
								type: "RunWarned",
								runId,
								payload: { kind: "base-ref", message: made.warning },
							});
						}
						for (const message of [...planned.notes, ...prepared.notes]) {
							await facts.append({
								type: "RunWarned",
								runId,
								payload: { kind: "device-fallback", message },
							});
						}
						started = { row, device };
						return {
							row,
							inputs: prepared.inputs,
							stopAt: prepared.stopAt,
							dueAt: rules.dueAt(trigger),
						};
					}),
			});
			if (!started) throw new Error("Could not create the run.");
			return starters.summary(started.row, started.device);
		});
	};

/** The row `NewRuns.started` gives back. */
type NewRunRow = Awaited<ReturnType<NewRuns["started"]>>;
