import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { run } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import type { StartRunInput } from "../contract";
import type { Device, RunFolder, Worktree } from "../device";
import { kindOf, type Runner, resolveInputs, runFolderOn } from "../graph";
import {
	type InputValues,
	planColumns,
	type RunLog,
	type RunRow,
	type RunTrigger,
	runDueAt,
} from "../log";
import {
	capabilitiesFor,
	type PlacementPort,
	type PlannedRun,
	refusalOf,
} from "../placement";
import type { ListedProject } from "../projects";
import {
	gitAuthorOf,
	namesOf,
	type RunSummary,
	runFacts,
	toSummary,
} from "../read";
import { checkServiceDevices } from "./service-devices";
import {
	checkTestRun,
	type ResolvedTestRun,
	refuseTestStart,
	resolveTestRun,
} from "./test-run";

/**
 * Run start: from a `StartRunInput` to a run the runner drives. Two layers
 * behind one seam:
 *
 * - The run's plan (`PlacementPort.plan`, the devices' planner) loads the
 *   flow and the flows it calls from the run's Device, places every node
 *   on a Device and resolves its profile there. `prepareRun` then asks
 *   every requirement whether each Device has what its nodes need (its
 *   `capabilities`: connections, CLI tools, harnesses, a decider), with
 *   the one fit check of Placement (`placement/fit.ts`). Neither
 *   writes anything; a refusal is an `Error` with the message the person
 *   sees, and a pass is a `PreparedRun`.
 * - `createRunStart(deps).start` is the start's Turn of the runner
 *   (`runner.take`): with the slot held, it plans the run, prepares it,
 *   has the run's Device create the worktree, writes the run row with its
 *   plan, appends `RunStarted` and `WorktreeCreated` and hands the thread
 *   to the runner. This computer walks the run wherever its steps run.
 *   When the run's Device is offline, the row has no worktree and the run
 *   waits: its first step that works in the worktree makes it there when
 *   the Device is back (ADR 1, decision 11).
 * - A run of a project without a folder (ADR 22) gets a run folder on its
 *   Device instead (`Device.runFolder`): empty, with no branch and no
 *   base. `RunStarted.runFolder` says so to every reader.
 * - A test run (ADR 27, `test-run.ts`) is a person's start of a saved
 *   flow with pins and skips. Its pins resolve from this Walker's log
 *   before the plan, which leaves their nodes out; `RunStarted.test`
 *   records the output each pin gives.
 */

/** A base for a run of a project without a folder: it has no branches. */
export const NO_BRANCHES =
	"A project without a folder has no branches. Leave Start from empty.";

const TITLE_MAX_CHARS = 80;
const QUICK_RUN_TITLE = "Quick run";

/** The title of a run without a flow name: the first Agent prompt, cut short. */
export function quickRunTitle(flow: Flow): string {
	const agent = flow.nodes.find((n) => n.type === "agent");
	const text = (agent?.prompt ?? "").replace(/\s+/g, " ").trim();
	if (!text) return QUICK_RUN_TITLE;
	if (text.length <= TITLE_MAX_CHARS) return text;
	return `${text.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

/** A run that passed every check and can start. */
export type PreparedRun = {
	flow: Flow;
	flowName: string | null;
	flowRevision: string | null;
	calledFlows: Record<string, Flow>;
	calledFlowRevisions: Record<string, string>;
	inputs: InputValues;
	title: string;
	stopAt: number | null;
	/** What the run warns about from the start, beyond the plan's notes. */
	notes: string[];
};

/** Names as a person reads a list of them: "a", "a and b", "a, b and c". */
function listOf(names: readonly string[]): string {
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The note of a run in run folders whose folder steps sit on more than
 * one Device: each has its own folder, with its own files (ADR 22). None
 * when they share one Device.
 */
function runFolderNotes(groups: PlannedRun["groups"]): string[] {
	const names = new Map<string, string>();
	for (const { at, nodes } of groups) {
		if (nodes.some((n) => kindOf(n).works(n) === "worktree")) {
			names.set(at.id, at.name);
		}
	}
	if (names.size < 2) return [];
	return [
		`The steps of this run work in folders on ${listOf([...names.values()])}. Each device has its own folder, so the files of one are not on the other.`,
	];
}

/**
 * Checks a planned run before anything is written, in the order the person
 * sees the refusals (after the plan's own: its Devices, the flow and its
 * called flows, each node's Device and profile): every `REQUIREMENTS` entry
 * passes on each Device for the nodes placed on it (an offered Device's
 * Offers stand in for them, and an offline Device is not asked), and a
 * Device whose nodes work in the worktree
 * has a Clone; the stop time is ahead; the inputs resolve. Throws the
 * refusal, returns the prepared run. A Device checks its Clone is ready
 * when it adds the worktree, before the run is written. A run of a
 * project without a folder (`runFolder`) takes no base. A test run's
 * pins and skips (`test`) are checked first: the plan left their nodes
 * out, so no Device answers for them.
 */
export async function prepareRun(
	input: StartRunInput,
	planned: PlannedRun,
	deps: { now(): number },
	runFolder = false,
	test: ResolvedTestRun | null = null,
): Promise<PreparedRun> {
	const { flow, flowName, flowRevision, calledFlows, calledFlowRevisions } =
		planned;
	if (test) checkTestRun(flow, test);
	if (runFolder && input.baseRef !== undefined) {
		throw new Refusal("invalid", NO_BRANCHES);
	}
	for (const { at, nodes } of planned.groups) {
		// An offline Device checks each call itself when it is back.
		const refusal =
			at.offered || at.offline
				? null
				: refusalOf(nodes, await capabilitiesFor(nodes, at.device));
		if (refusal !== null) throw new Refusal("conflict", refusal);
		const worker = nodes.find((n) => kindOf(n).works(n) === "worktree");
		if (worker && !at.hasClone) {
			throw new Refusal(
				"conflict",
				`The flow runs node "${worker.id}" on ${at.name}, but that device does not have this project. Add its folder there first.`,
			);
		}
	}
	checkServiceDevices(planned);
	if (input.stopAt !== undefined && input.stopAt <= deps.now()) {
		throw new Refusal("invalid", "The stop time has passed already.");
	}
	const inputs = resolveInputs(flow.inputs ?? [], input.inputs, {
		what: "The flow",
		jsonText: "strict",
	});
	const textInputs = (flow.inputs ?? []).flatMap((def) => {
		const value = inputs[def.name];
		return (def.type ?? "text") === "text" &&
			typeof value === "string" &&
			value !== ""
			? [`${def.name} ${value}`]
			: [];
	});
	const title = flowName
		? [flowName, ...textInputs].join(" · ").slice(0, 120)
		: quickRunTitle(flow);
	return {
		flow,
		flowName,
		flowRevision,
		calledFlows,
		calledFlowRevisions,
		inputs,
		title,
		stopAt: input.stopAt ?? null,
		notes: runFolder ? runFolderNotes(planned.groups) : [],
	};
}

export type RunStartDeps = {
	/** How long a start may take before it gives up. Default `START_DEADLINE_MS`. */
	startDeadlineMs?: number;
	db: Database;
	log: RunLog;
	runner: Pick<Runner, "take">;
	now(): number;
	/**
	 * A project a person has not removed, in any Space (the run takes its
	 * Space); throws for another id. Its Clone may be on another Device.
	 */
	projectRow(projectId: string): Promise<ListedProject>;
	/**
	 * The run's plan (`PlacementPort.plan`): the Person it runs for, its
	 * Device and each node's, and the flows from that Device's Clone.
	 * Throws the refusal when the run cannot run there.
	 */
	plan: PlacementPort["plan"];
	/** This computer's name: the Walker of the runs it starts. */
	selfName: string;
	/** The name of a Person as the Space document's Members name them. Default: none. */
	memberName?(spaceId: string, personId: string): Promise<string | null>;
};

export type RunStart = ReturnType<typeof createRunStart>;

/** The writing half of run start, over `prepareRun`. */
/**
 * How long a start may take, from its plan to its row. Each call to a
 * Device has its own, shorter limit (copying the project takes the
 * longest); this one catches any other wait, so a start that hangs frees
 * its place in the run cap and tells the person.
 */
export const START_DEADLINE_MS = 4 * 60_000;

/** Why a start that took too long gave up. */
export const START_TOO_LONG =
	"The run did not start in time. Check that its device is online, then start the run again.";

/**
 * Runs `work` until it settles or `ms` passes: then it is refused, and
 * `work` sees its signal aborted, so it writes nothing after that.
 */
async function beforeDeadline<T>(
	ms: number,
	work: (deadline: AbortSignal) => Promise<T>,
): Promise<T> {
	const deadline = AbortSignal.timeout(ms);
	let onAbort = () => {};
	const late = new Promise<never>((_, reject) => {
		onAbort = () => reject(new Refusal("unavailable", START_TOO_LONG));
		deadline.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([work(deadline), late]);
	} finally {
		deadline.removeEventListener("abort", onAbort);
	}
}

export function createRunStart(deps: RunStartDeps) {
	const { db, log, runner } = deps;

	/**
	 * Validates the flow (refuses one with errors), snapshots it, creates the
	 * worktree, starts the thread at the start node, and returns at once.
	 * All of it is the start's Turn (`runner.take`): the slot is held before
	 * the first await, so two starts cannot both pass the run cap, and a
	 * stop that comes meanwhile waits for the walk to begin.
	 */
	async function start(
		input: StartRunInput,
		trigger: RunTrigger,
	): Promise<RunSummary> {
		refuseTestStart(input, trigger);
		const runId = randomUUID();
		let started: { row: RunRow; walkerId: string; device: Device } | undefined;
		await runner.take(runId, {
			kind: "start",
			prepare: () =>
				beforeDeadline(
					deps.startDeadlineMs ?? START_DEADLINE_MS,
					async (deadline) => {
						const projectRow = await deps.projectRow(input.projectId);
						// A test run's pins come from this Walker's log, before the
						// plan: it leaves their nodes out (ADR 27).
						const test = await resolveTestRun(input.test, projectRow, log);
						// Every run has a starter, and the plan names them: the Person
						// who starts it, else this computer's owner (a schedule that
						// names no Person fires here for them), as the Host of the
						// Space knows them.
						const planned = await deps.plan({
							start: input,
							project: projectRow,
							runId,
							scheduled: trigger.kind === "schedule",
							byPerson: trigger.kind === "manual",
						});
						const startedBy = planned.plan.personId;
						const { device } = planned.run;
						// A project without a folder: the run works in a run folder (ADR 22).
						const runFolder = projectRow.folder === false;
						const prepared = await prepareRun(
							input,
							planned,
							deps,
							runFolder,
							test,
						);
						const {
							flow,
							flowName,
							flowRevision,
							calledFlows,
							calledFlowRevisions,
							inputs,
							title,
						} = prepared;
						const authorId = input.startedBy ?? startedBy;
						const author =
							authorId && !runFolder ? await gitAuthorOf(db, authorId) : null;
						// The worktree lives on the run's Device. An offline one makes it
						// when it is back: until then the row keeps the base the person
						// asked for, and no branch. So does a run folder.
						const made: Worktree | RunFolder | null = planned.run.offline
							? null
							: runFolder
								? await runFolderOn(device, {
										id: runId,
										projectId: projectRow.id,
									})
								: await device.worktree({
										id: runId,
										projectId: projectRow.id,
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
						if (deadline.aborted)
							throw new Refusal("unavailable", START_TOO_LONG);
						const walkerId = await log.walkerId();
						// The row and the event that names it are one batch.
						await log.append(
							{
								type: "RunStarted",
								runId,
								payload: {
									projectId: projectRow.id,
									flowName,
									...(flowRevision !== null ? { flowRevision } : {}),
									title,
									start: flow.start,
									stopAt: prepared.stopAt,
									inputs,
									trigger,
									startedBy,
									...(runFolder ? { runFolder: true as const } : {}),
									...(test ? { test: test.test } : {}),
								},
							},
							{
								before: [
									db.insert(run).values({
										id: runId,
										// The run is in its project's Space, also when the scheduler starts it.
										spaceId: projectRow.spaceId,
										projectId: projectRow.id,
										flowName,
										flow: JSON.stringify(flow),
										bodyFlows: JSON.stringify(calledFlows),
										flowRevision,
										bodyFlowRevisions: JSON.stringify(calledFlowRevisions),
										title,
										worktreePath: worktree?.worktreePath ?? "",
										branch: worktree?.branch ?? "",
										baseRef: worktree?.baseRef ?? input.baseRef ?? "",
										walkerId,
										// The walk reads the plan, and decides nothing again.
										...planColumns(planned.plan),
									}),
								],
							},
						);
						const [row] = await db.select().from(run).where(eq(run.id, runId));
						if (!row) throw new Error("Could not create the run.");
						if (worktree) {
							await log.append({
								type: "WorktreeCreated",
								runId,
								payload: worktree,
							});
						}
						if (made && "warning" in made && made.warning) {
							await log.append({
								type: "RunWarned",
								runId,
								payload: { kind: "base-ref", message: made.warning },
							});
						}
						for (const message of [...planned.notes, ...prepared.notes]) {
							await log.append({
								type: "RunWarned",
								runId,
								payload: { kind: "device-fallback", message },
							});
						}
						started = { row, walkerId, device };
						return {
							row,
							inputs,
							stopAt: prepared.stopAt,
							dueAt: runDueAt(trigger),
						};
					},
				),
		});
		if (!started) throw new Error("Could not create the run.");
		const { row, walkerId, device } = started;
		const { memberName } = deps;
		return toSummary(
			row,
			runFacts(await log.state(runId)),
			await namesOf(
				db,
				[row.startedBy],
				memberName && ((personId) => memberName(row.spaceId, personId)),
			),
			{ id: walkerId, name: deps.selfName, thisDevice: true },
			{
				id: device.id,
				name: device.id === walkerId ? deps.selfName : device.name,
				thisDevice: device.id === walkerId,
			},
		);
	}

	return { start };
}
