import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { run } from "@nightshift/db/schema";
import type { Flow, FlowNode, FlowNodeType } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import type { StartRunInput } from "../contract";
import type { Capabilities, Device } from "../device";
import {
	kindOf,
	kindOfType,
	missingNames,
	NODE_KINDS,
	type NodeKind,
	onDevice,
	type Requirement,
	type Runner,
	resolveInputs,
} from "../graph";
import {
	type InputValues,
	planColumns,
	type RunLog,
	type RunRow,
	type RunTrigger,
} from "../log";
import type { ListedProject } from "../projects";
import {
	gitAuthorOf,
	namesOf,
	type RunSummary,
	runFacts,
	toSummary,
} from "../read";
import type { PlacementPort, PlannedRun } from "./peers";

/**
 * Run start: from a `StartRunInput` to a run the runner drives. Two layers
 * behind one seam:
 *
 * - The run's plan (`PlacementPort.plan`, the devices' planner) loads the
 *   flow and the flows it calls from the run's Device, places every node
 *   on a Device and resolves its profile there. `prepareRun` then asks
 *   every requirement whether each Device has what its nodes need (its
 *   `capabilities`: connections, CLI tools, harnesses, a decider). Neither
 *   writes anything; a refusal is an `Error` with the message the person
 *   sees, and a pass is a `PreparedRun`.
 * - `createRunStart(deps).start` is the start's Turn of the runner
 *   (`runner.take`): with the slot held, it plans the run, prepares it,
 *   has the run's Device create the worktree, writes the run row with its
 *   plan, appends `RunStarted` and `WorktreeCreated` and hands the thread
 *   to the runner. This computer walks the run wherever its steps run.
 *
 * The requirements are one function each (`Requirement`) and listed once,
 * in `REQUIREMENTS`, in the order the person sees them. The ones about one
 * kind live on that kind's descriptor (`NodeKind.requirements`: an Agent's
 * CLI tools and harness, a model Decision's and a model Value's
 * decider); the connections check is the one shared requirement, and it
 * asks each kind which connections its node names (`NodeKind.connections`).
 * This module switches on no node type to ask them.
 */

const TITLE_MAX_CHARS = 80;
const QUICK_RUN_TITLE = "Quick run";

export type { Requirement } from "../graph";

/** Every node names connections the Device has (Agent and Tool nodes do). */
export const connectionsExist: Requirement = (nodes, has) => {
	const unknown = missingNames(
		nodes,
		(node) => kindOf(node).connections(node),
		new Set(has.connections),
	);
	if (unknown.length === 0) return null;
	return unknown
		.map(
			({ name, nodeIds }) =>
				`The flow uses the connection "${name}" (${nodeIds.join(", ")}), but no connection has that name${onDevice(has)}. Add it under Agents → Tools.`,
		)
		.join(" ");
};

/**
 * A kind's own requirements as ones over every node: each gets the nodes
 * of its kind only, so it switches on nothing.
 */
function ofKind(kind: NodeKind): Requirement[] {
	return kind.requirements.map(
		(requirement) => (nodes, has) =>
			requirement(
				nodes.filter((n) => n.type === kind.type),
				has,
			),
	);
}

/**
 * Every requirement, in the order a person sees them: the connections
 * every kind names first, then each kind's own, kind by kind in the
 * registry's order (`NODE_KINDS`).
 */
export const REQUIREMENTS: readonly Requirement[] = [
	connectionsExist,
	...(Object.keys(NODE_KINDS) as FlowNodeType[]).flatMap((type) =>
		ofKind(kindOfType(type)),
	),
];

/** What the Device has for these nodes: its capabilities, with the programs the nodes name looked up. */
export function capabilitiesFor(
	nodes: readonly FlowNode[],
	device: Pick<Device, "capabilities">,
): Promise<Capabilities> {
	const programs = new Set(nodes.flatMap((n) => kindOf(n).programs(n)));
	return device.capabilities({ programs: [...programs] });
}

/** The first requirement these nodes fail, as the message that refuses the run; null when all pass. */
export function refusalOf(
	nodes: readonly FlowNode[],
	has: Capabilities,
): string | null {
	for (const requirement of REQUIREMENTS) {
		const why = requirement(nodes, has);
		if (why !== null) return why;
	}
	return null;
}

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
	calledFlows: Record<string, Flow>;
	inputs: InputValues;
	title: string;
	stopAt: number | null;
};

/**
 * Checks a planned run before anything is written, in the order the person
 * sees the refusals (after the plan's own: its Devices, the flow and its
 * called flows, each node's Device and profile): every `REQUIREMENTS` entry
 * passes on each Device for the nodes placed on it (an offered Device's
 * Offers stand in for them), and a Device whose nodes work in the worktree
 * has a Clone; the stop time is ahead; the inputs resolve. Throws the
 * refusal, returns the prepared run. A Device checks its Clone is ready
 * when it adds the worktree, before the run is written.
 */
export async function prepareRun(
	input: StartRunInput,
	planned: PlannedRun,
	deps: { now(): number },
): Promise<PreparedRun> {
	const { flow, flowName, calledFlows } = planned;
	for (const { at, nodes } of planned.groups) {
		const refusal = at.offered
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
		calledFlows,
		inputs,
		title,
		stopAt: input.stopAt ?? null,
	};
}

export type RunStartDeps = {
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
};

export type RunStart = ReturnType<typeof createRunStart>;

/** The writing half of run start, over `prepareRun`. */
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
		const runId = randomUUID();
		let started: { row: RunRow; walkerId: string; device: Device } | undefined;
		await runner.take(runId, {
			kind: "start",
			prepare: async () => {
				const projectRow = await deps.projectRow(input.projectId);
				// Every run has a starter, and the plan names them: the Person
				// who starts it, else this computer's owner (a schedule that
				// names no Person fires here for them), as the Host of the
				// Space knows them.
				const planned = await deps.plan({
					start: input,
					project: projectRow,
					runId,
					scheduled: trigger.kind === "schedule",
				});
				const startedBy = planned.plan.personId;
				const { device } = planned.run;
				const prepared = await prepareRun(input, planned, deps);
				const { flow, flowName, calledFlows, inputs, title } = prepared;
				const authorId = input.startedBy ?? startedBy;
				const author = authorId ? await gitAuthorOf(db, authorId) : null;
				// The worktree lives on the run's Device.
				const worktree = await device.worktree({
					id: runId,
					projectId: projectRow.id,
					...(input.baseRef !== undefined ? { baseRef: input.baseRef } : {}),
					...(author ? { author } : {}),
				});
				const walkerId = await log.walkerId();
				// The row and the event that names it are one batch.
				await log.append(
					{
						type: "RunStarted",
						runId,
						payload: {
							projectId: projectRow.id,
							flowName,
							title,
							start: flow.start,
							stopAt: prepared.stopAt,
							inputs,
							trigger,
							startedBy,
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
								title,
								worktreePath: worktree.worktreePath,
								branch: worktree.branch,
								baseRef: worktree.baseRef,
								walkerId,
								// The walk reads the plan, and decides nothing again.
								...planColumns(planned.plan),
							}),
						],
					},
				);
				const [row] = await db.select().from(run).where(eq(run.id, runId));
				if (!row) throw new Error("Could not create the run.");
				await log.append({
					type: "WorktreeCreated",
					runId,
					payload: worktree,
				});
				started = { row, walkerId, device };
				return { row, inputs, stopAt: prepared.stopAt };
			},
		});
		if (!started) throw new Error("Could not create the run.");
		const { row, walkerId, device } = started;
		return toSummary(
			row,
			runFacts(await log.events(runId)),
			await namesOf(db, [row.startedBy]),
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
