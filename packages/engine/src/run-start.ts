import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { run } from "@nightshift/db/schema/nightshift";
import {
	type AgentProfileSettings,
	type Flow,
	type FlowIssue,
	type FlowNode,
	type FlowNodeType,
	migrateFlow,
	parseFlow,
	resolveAgentNode,
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

/** A Device a run's nodes run on, as run start placed it. */
export type PlacedDevice = {
	device: Device;
	id: string;
	name: string;
	/** This computer: the Walker. */
	thisDevice: boolean;
	/** It has a Clone of the project: a step that works in the worktree can run there. */
	hasClone: boolean;
};

/** What `prepareRun` needs: the Walker's profiles, the Devices nodes name, the clock. */
export type PrepareRunDeps = {
	/** An Agent Profile of this computer (the Walker) by name, or null. */
	profileFor: ProfileFor;
	now(): number;
	/**
	 * One of the starter's Devices, by the name a node gives it (`device`).
	 * Throws the refusal: no Device of that name, two of them, another
	 * Person's, offline. Without it, a node that names a Device refuses.
	 */
	deviceNamed?(name: string): Promise<PlacedDevice>;
	/** This computer, where a profile only it has runs. */
	walker?: PlacedDevice;
};

/** A run that passed every check and can start. */
export type PreparedRun = {
	flow: Flow;
	flowName: string | null;
	calledFlows: Record<string, Flow>;
	inputs: InputValues;
	title: string;
	stopAt: number | null;
	/** The Devices the nodes name, by name: the run's `placements`. */
	placements: Record<string, string>;
};

/** The Device a node names, if its kind runs on one. */
function namedDevice(node: FlowNode): string | undefined {
	return "device" in node ? node.device : undefined;
}

/**
 * Where each node runs, and its profile: the node's `device`, else the
 * profile's Device (the run's Device when it has the profile, else this
 * computer when only it has), else the run's Device. Returns the flows
 * with their profiles resolved and a node that runs on this computer for
 * its profile named so, and the Devices by name.
 */
async function placeNodes(
	flows: readonly Flow[],
	runDevice: PlacedDevice,
	deps: PrepareRunDeps,
): Promise<{ flows: Flow[]; named: Map<string, PlacedDevice> }> {
	const nodes = flows.flatMap((f) => f.nodes);
	const named = new Map<string, PlacedDevice>();
	for (const node of nodes) {
		const name = namedDevice(node);
		if (name === undefined || named.has(name)) continue;
		if (name === runDevice.name) {
			named.set(name, runDevice);
			continue;
		}
		if (!deps.deviceNamed) {
			throw new Error(
				`The flow runs node "${node.id}" on "${name}", but this computer cannot reach your other devices.`,
			);
		}
		named.set(name, await deps.deviceNamed(name));
	}

	// The profiles each Device is asked for: a node's own Device, else the
	// run's, with this computer as the fallback.
	const walker =
		deps.walker && deps.walker.id !== runDevice.id ? deps.walker : null;
	const wanted = new Map<PlacedDevice, Set<string>>();
	const want = (at: PlacedDevice, profile: string) => {
		const set = wanted.get(at) ?? new Set();
		set.add(profile);
		wanted.set(at, set);
	};
	for (const node of nodes) {
		if (node.type !== "agent" || node.profile === undefined) continue;
		const name = namedDevice(node);
		if (name !== undefined) {
			want(named.get(name) as PlacedDevice, node.profile);
		} else {
			want(runDevice, node.profile);
			if (walker) want(walker, node.profile);
		}
	}
	const found = new Map<PlacedDevice, Record<string, AgentProfileSettings>>();
	for (const [at, names] of wanted) {
		found.set(
			at,
			at.thisDevice
				? Object.fromEntries(
						[...names].flatMap((n) => {
							const profile = deps.profileFor(n);
							return profile ? [[n, profile]] : [];
						}),
					)
				: (await at.device.capabilities({ profiles: [...names] })).profiles,
		);
	}

	const missing = new Map<string, { nodeIds: string[]; on: string | null }>();
	const miss = (profile: string, nodeId: string, on: string | null) => {
		const key = `${profile}\u0000${on ?? ""}`;
		const entry = missing.get(key) ?? { nodeIds: [], on };
		if (!entry.nodeIds.includes(nodeId)) entry.nodeIds.push(nodeId);
		missing.set(key, entry);
	};
	const placed = flows.map((flow) => ({
		...flow,
		nodes: flow.nodes.map((node): FlowNode => {
			if (node.type !== "agent" || node.profile === undefined) return node;
			const name = namedDevice(node);
			if (name !== undefined) {
				const at = named.get(name) as PlacedDevice;
				const profile = found.get(at)?.[node.profile];
				if (!profile) {
					miss(node.profile, node.id, at.thisDevice ? null : at.name);
					return node;
				}
				return resolveAgentNode(node, profile);
			}
			const own = found.get(runDevice)?.[node.profile];
			if (own) return resolveAgentNode(node, own);
			const here = walker ? found.get(walker)?.[node.profile] : undefined;
			if (walker && here) {
				// The profile's Device: only this computer has it.
				named.set(walker.name, walker);
				return { ...resolveAgentNode(node, here), device: walker.name };
			}
			miss(node.profile, node.id, runDevice.thisDevice ? null : runDevice.name);
			return node;
		}),
	}));
	if (missing.size > 0) {
		throw new Error(
			[...missing]
				.map(([key, { nodeIds, on }]) => {
					const name = key.split("\u0000")[0];
					return on === null
						? `The flow uses the profile "${name}" (${nodeIds.join(", ")}), but no profile has that name. Add it under Agents.`
						: `The flow uses the profile "${name}" (${nodeIds.join(", ")}) on ${on}, but that device has no profile of that name. Add it under Agents.`;
				})
				.join(" "),
		);
	}
	return { flows: placed, named };
}

/**
 * Checks a run before anything is written, in the order the person sees
 * the refusals: the flow and its called flows (from the project's Clone on
 * the run's Device) parse and validate; every node is placed on a Device
 * of the starter's and its profile exists there (the run's copy holds the
 * profiles as they are now); every `REQUIREMENTS` entry passes on each
 * Device for the nodes placed on it, and a Device whose nodes work in the
 * worktree has a Clone; the stop time is ahead; the inputs resolve. Throws
 * the refusal, returns the prepared run. A Device checks its Clone is
 * ready when it adds the worktree, before the run is written.
 */
export async function prepareRun(
	input: StartRunInput,
	runDevice: PlacedDevice,
	deps: PrepareRunDeps,
): Promise<PreparedRun> {
	const loaded = flowsForRun(
		await runDevice.device.flows(input.projectId),
		input,
	);
	const { flowName } = loaded;
	const calledNames = Object.keys(loaded.calledFlows);
	const { flows, named } = await placeNodes(
		[loaded.flow, ...Object.values(loaded.calledFlows)],
		runDevice,
		deps,
	);
	const [flow, ...called] = flows as [Flow, ...Flow[]];
	const calledFlows = Object.fromEntries(
		calledNames.map((name, i) => [name, called[i] as Flow]),
	);
	// Each Device answers for the nodes placed on it.
	const groups = new Map<PlacedDevice, FlowNode[]>();
	for (const node of flows.flatMap((f) => f.nodes)) {
		const name = namedDevice(node);
		const at = name !== undefined ? (named.get(name) ?? runDevice) : runDevice;
		groups.set(at, [...(groups.get(at) ?? []), node]);
	}
	for (const [at, nodes] of groups) {
		const refusal = refusalOf(nodes, await capabilitiesFor(nodes, at.device));
		if (refusal !== null) throw new Error(refusal);
		const worker = nodes.find((n) => kindOf(n).works(n) === "worktree");
		if (worker && !at.hasClone) {
			throw new Error(
				`The flow runs node "${worker.id}" on ${at.name}, but that device does not have this project. Add its folder there first.`,
			);
		}
	}
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
		placements: Object.fromEntries(
			[...named].map(([name, at]) => [name, at.id]),
		),
	};
}

export type RunStartDeps = Omit<PrepareRunDeps, "deviceNamed" | "walker"> & {
	db: Database;
	log: RunLog;
	runner: Runner;
	/**
	 * A project a person has not removed, in any Space (the run takes its
	 * Space); throws for another id. Its Clone may be on another Device.
	 */
	projectRow(projectId: string): Promise<ListedProject>;
	/**
	 * Where the run's steps run (its Placement): the run's Device
	 * (`deviceId`, else this computer), the starter's other Devices by the
	 * name a node gives one, and this computer. Throws the refusal when the
	 * run cannot run there.
	 */
	place(input: {
		deviceId: string | undefined;
		project: ListedProject;
		runId: string;
		/** The Person who starts it, as the Space's Host knows them. */
		personId: string | null;
	}): Promise<{
		run: PlacedDevice;
		walker: PlacedDevice;
		deviceNamed(name: string): Promise<PlacedDevice>;
	}>;
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
			const placement = await deps.place({
				deviceId: input.deviceId,
				project: projectRow,
				runId,
				personId: startedBy,
			});
			const { device } = placement.run;
			const prepared = await prepareRun(input, placement.run, {
				...deps,
				walker: placement.walker,
				deviceNamed: placement.deviceNamed,
			});
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
					placements:
						Object.keys(prepared.placements).length > 0
							? JSON.stringify(prepared.placements)
							: null,
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
