import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { run } from "@nightshift/db/schema/nightshift";
import {
	type Flow,
	type FlowIssue,
	type FlowNode,
	type FlowNodeType,
	migrateFlow,
	parseFlow,
	resolveFlowProfiles,
	validateFlow,
} from "@nightshift/flows";
import { type FlowSources, parsedFlows } from "@nightshift/flows/files";

import type { Capabilities, Device } from "./device/types";
import type { InputValues } from "./events";
import { personOnHost } from "./exchange/host-spaces";
import { type NodeKind, onDevice, type Requirement } from "./graph/context";
import { kindOf, kindOfType, NODE_KINDS } from "./graph/node-kinds";
import { missingNames } from "./graph/nodes/agent";
import type { Runner } from "./graph/runner";
import { resolveInputs } from "./inputs";
import { gitAuthorOf, namesOf } from "./people";
import type { ListedProject } from "./projects";
import { runFacts, toSummary } from "./read-model";
import type { RunLog } from "./run-log";
import type {
	EngineOptions,
	RunSummary,
	RunTrigger,
	StartRunInput,
} from "./types";

/**
 * Run start: from a `StartRunInput` to a run the runner drives. Two layers
 * behind one seam:
 *
 * - `prepareRun` is the deep part. It loads and validates the flow and the
 *   flows it calls, resolves the profiles, and asks every requirement
 *   whether the run's Device has what the nodes need (its
 *   `capabilities`: connections, CLI tools, harnesses, a decider). It writes nothing; a refusal is an `Error` with
 *   the message the person sees, and a pass is a `PreparedRun`.
 * - `createRunStart(deps).start` holds the slot, places the run on its
 *   Device (`deps.place`: this computer, or another of the starter's
 *   Devices through the Host), prepares on that Device, has it create the
 *   worktree, writes the run row, appends `RunStarted` and
 *   `WorktreeCreated` and hands the thread to the runner. This computer
 *   walks the run wherever its steps run.
 *
 * The requirements are one function each (`Requirement`) and listed once,
 * in `REQUIREMENTS`, in the order the person sees them. The ones about one
 * kind live on that kind's descriptor (`NodeKind.requirements`: an Agent's
 * CLI tools, harness and checker, a model Decision's and a model Value's
 * decider); the connections check is the one shared requirement, and it
 * asks each kind which connections its node names (`NodeKind.connections`).
 * This module switches on no node type to ask them.
 */

const TITLE_MAX_CHARS = 80;
const QUICK_RUN_TITLE = "Quick run";

type ProfileFor = NonNullable<EngineOptions["profileFor"]>;

export type { Requirement } from "./graph/context";

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

/** The names of the flows a flow's Call nodes call. */
function calledFlowNames(flow: Flow): string[] {
	return flow.nodes.flatMap((n) => (n.type === "call" ? [n.flow] : []));
}

function refuseErrors(issues: readonly FlowIssue[], what = "The flow"): void {
	const errors = issues.filter((i) => i.severity === "error");
	if (errors.length === 0) return;
	const list = errors.map((e) => `- ${e.message}`).join("\n");
	throw new Error(
		`${what} cannot run. Fix ${errors.length === 1 ? "this error" : `these ${errors.length} errors`} first:\n${list}`,
	);
}

/** The title of a run without a flow name: the first Agent prompt, cut short. */
export function quickRunTitle(flow: Flow): string {
	const agent = flow.nodes.find((n) => n.type === "agent");
	const text = (agent?.prompt ?? "").replace(/\s+/g, " ").trim();
	if (!text) return QUICK_RUN_TITLE;
	if (text.length <= TITLE_MAX_CHARS) return text;
	return `${text.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * Loads, parses and validates the flow a run starts from, and every flow
 * it can call through Call nodes (by name, from the project's flow files).
 * Version 1 files migrate first.
 */
export function flowsForRun(
	sources: FlowSources,
	input: StartRunInput,
): {
	flow: Flow;
	flowName: string | null;
	calledFlows: Record<string, Flow>;
} {
	const files = parsedFlows(sources);
	let flow: Flow;
	let flowName: string | null;
	if (input.flowName !== undefined) {
		const source = Object.hasOwn(sources, input.flowName)
			? sources[input.flowName]
			: undefined;
		if (!source) {
			throw new Error(`The flow "${input.flowName}" does not exist.`);
		}
		const parsed = parseFlow(
			migrateFlow("json" in source ? source.json : null),
			{
				flows: files,
				name: input.flowName,
			},
		);
		refuseErrors(parsed.issues);
		if (!parsed.flow) {
			throw new Error(`The flow "${input.flowName}" is not valid.`);
		}
		flow = parsed.flow;
		flowName = input.flowName;
	} else {
		const parsed = parseFlow(migrateFlow(input.flow), { flows: files });
		refuseErrors(parsed.issues);
		if (!parsed.flow) throw new Error("The flow is not valid.");
		flow = parsed.flow;
		flowName = null;
	}
	const calledFlows: Record<string, Flow> = {};
	const queue = calledFlowNames(flow);
	while (queue.length > 0) {
		const name = queue.shift() as string;
		if (Object.hasOwn(calledFlows, name)) continue;
		const called = name === flowName ? flow : files[name];
		if (!called) {
			throw new Error(
				`The called flow "${name}" ${called === null ? "is not valid" : "does not exist"}.`,
			);
		}
		refuseErrors(
			validateFlow(called, { flows: files, name }),
			`The called flow "${name}"`,
		);
		calledFlows[name] = called;
		queue.push(...calledFlowNames(called));
	}
	return { flow, flowName, calledFlows };
}

/** What `prepareRun` needs: the run's Device, the profiles, the clock. */
export type PrepareRunDeps = {
	/** An Agent Profile by name, or null. */
	profileFor: ProfileFor;
	now(): number;
};

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
 * Checks a run before anything is written, in the order the person sees
 * the refusals: the flow and its called flows (from the project's Clone on
 * `device`) parse and validate; the profiles exist (the run's copy holds
 * them as they are now); every `REQUIREMENTS` entry passes on `device`;
 * the stop time is ahead; the inputs resolve. Throws the refusal, returns
 * the prepared run. The Device checks its Clone is ready when it adds the
 * worktree, before the run is written.
 */
export async function prepareRun(
	input: StartRunInput,
	device: Pick<Device, "capabilities" | "flows">,
	deps: PrepareRunDeps,
): Promise<PreparedRun> {
	const loaded = flowsForRun(await device.flows(input.projectId), input);
	const { flowName } = loaded;
	// The run's copy holds the profiles as they are now: a later
	// change to a profile reaches the next run, not this one.
	const unknownProfiles = new Map<string, string[]>();
	const flow = resolveFlowProfiles(
		loaded.flow,
		deps.profileFor,
		unknownProfiles,
	);
	const calledFlows = Object.fromEntries(
		Object.entries(loaded.calledFlows).map(([name, called]) => [
			name,
			resolveFlowProfiles(called, deps.profileFor, unknownProfiles),
		]),
	);
	if (unknownProfiles.size > 0) {
		throw new Error(
			[...unknownProfiles]
				.map(
					([name, nodeIds]) =>
						`The flow uses the profile "${name}" (${nodeIds.join(", ")}), but no profile has that name. Add it under Agents.`,
				)
				.join(" "),
		);
	}
	const all = [flow, ...Object.values(calledFlows)];
	const nodes = all.flatMap((f) => f.nodes);
	const refusal = refusalOf(nodes, await capabilitiesFor(nodes, device));
	if (refusal !== null) throw new Error(refusal);
	if (input.stopAt !== undefined && input.stopAt <= deps.now()) {
		throw new Error("The stop time has passed already.");
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

export type RunStartDeps = PrepareRunDeps & {
	db: Database;
	log: RunLog;
	runner: Runner;
	/**
	 * A project a person has not removed, in any Space (the run takes its
	 * Space); throws for another id. Its Clone may be on another Device.
	 */
	projectRow(projectId: string): Promise<ListedProject>;
	/**
	 * The Device the run's steps run on (the run's Placement): `deviceId`,
	 * else this computer. Throws the refusal when the run cannot run there.
	 */
	place(input: {
		deviceId: string | undefined;
		project: ListedProject;
		runId: string;
		/** The Person who starts it, as the Space's Host knows them. */
		personId: string | null;
	}): Promise<Device>;
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
	 * The slot is reserved before the first await, so two starts cannot both
	 * pass the run cap.
	 */
	async function start(
		input: StartRunInput,
		trigger: RunTrigger,
	): Promise<RunSummary> {
		const runId = randomUUID();
		runner.reserveSlot(runId);
		try {
			const projectRow = await deps.projectRow(input.projectId);
			// In a Host's Space, the Person as the Host knows them.
			const startedBy = input.startedBy
				? ((await personOnHost(db, projectRow.spaceId)) ?? input.startedBy)
				: null;
			const device = await deps.place({
				deviceId: input.deviceId,
				project: projectRow,
				runId,
				personId: startedBy,
			});
			const prepared = await prepareRun(input, device, deps);
			const { flow, flowName, calledFlows, inputs, title } = prepared;
			const author = input.startedBy
				? await gitAuthorOf(db, input.startedBy)
				: null;
			// The worktree lives on the run's Device.
			const worktree = await device.worktree({
				id: runId,
				projectId: projectRow.id,
				...(input.baseRef !== undefined ? { baseRef: input.baseRef } : {}),
				...(author ? { author } : {}),
			});
			const walkerId = await log.walkerId();
			const [row] = await db
				.insert(run)
				.values({
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
					deviceId: device.id,
					startedBy,
				})
				.returning();
			if (!row) throw new Error("Could not create the run.");
			await log.append({
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
			});
			await log.append({
				type: "WorktreeCreated",
				runId,
				payload: worktree,
			});
			runner.start(row, inputs, prepared.stopAt);
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
		} finally {
			runner.releaseStartingSlot(runId);
		}
	}

	return { start };
}
