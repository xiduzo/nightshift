import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@nightshift/db";
import { run } from "@nightshift/db/schema/nightshift";
import {
	type Flow,
	type FlowIssue,
	type FlowNode,
	type FlowNodeType,
	flowSchema,
	migrateFlow,
	parseFlow,
	resolveFlowProfiles,
	validateFlow,
} from "@nightshift/flows";
import { flowsDir } from "@nightshift/flows/files";

import type { Capabilities, Device } from "./device/types";
import type { InputValues } from "./events";
import type { NodeKind, Requirement } from "./graph/context";
import { kindOf, kindOfType, NODE_KINDS } from "./graph/node-kinds";
import { missingNames } from "./graph/nodes/agent";
import type { Runner } from "./graph/runner";
import { resolveInputs } from "./inputs";
import { checkProjectFolder } from "./project-setup";
import type { ProjectRow } from "./projects";
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
 * - `createRunStart(deps).start` holds the slot, prepares, has the Device
 *   create the worktree, writes the run row, appends `RunStarted` and `WorktreeCreated`
 *   and hands the thread to the runner.
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
				`The flow uses the connection "${name}" (${nodeIds.join(", ")}), but no connection has that name. Add it under Agents → Tools.`,
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
): Capabilities {
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
 * The raw JSON of every flow file of a project, by name. A file that is not
 * JSON reads as null. A missing directory is an empty record.
 */
export async function readProjectFlowFiles(
	repoPath: string,
): Promise<Record<string, unknown>> {
	const dir = flowsDir(repoPath);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return {};
	}
	const files: Record<string, unknown> = {};
	for (const file of names.filter((n) => n.endsWith(".json")).sort()) {
		const text = await readFile(join(dir, file), "utf8");
		try {
			files[file.slice(0, -".json".length)] = JSON.parse(text);
		} catch {
			files[file.slice(0, -".json".length)] = null;
		}
	}
	return files;
}

/**
 * Loads, parses and validates the flow a run starts from, and every flow
 * it can call through Call nodes (by name, from the project's flow files).
 * Version 1 files migrate first.
 */
export async function flowsForRun(
	repoPath: string,
	input: StartRunInput,
): Promise<{
	flow: Flow;
	flowName: string | null;
	calledFlows: Record<string, Flow>;
}> {
	const raw = await readProjectFlowFiles(repoPath);
	const files: Record<string, Flow | null> = {};
	for (const [name, json] of Object.entries(raw)) {
		const parsed = flowSchema.safeParse(migrateFlow(json));
		files[name] = parsed.success ? parsed.data : null;
	}
	let flow: Flow;
	let flowName: string | null;
	if (input.flowName !== undefined) {
		if (!Object.hasOwn(raw, input.flowName)) {
			throw new Error(`The flow "${input.flowName}" does not exist.`);
		}
		const parsed = parseFlow(migrateFlow(raw[input.flowName]), {
			flows: files,
			name: input.flowName,
		});
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

/** What `prepareRun` needs: the project, the run's Device, the clock. */
export type PrepareRunDeps = {
	/** The Device the run's requirements ask, and its worktree's home. */
	device: Device;
	/** A project that a person has not removed; throws for another id. */
	projectRow(projectId: string): Promise<ProjectRow>;
	/** An Agent Profile by name, or null. */
	profileFor: ProfileFor;
	probeGit?: EngineOptions["probeGit"];
	now(): number;
};

/** A run that passed every check and can start. */
export type PreparedRun = {
	projectRow: ProjectRow;
	flow: Flow;
	flowName: string | null;
	calledFlows: Record<string, Flow>;
	inputs: InputValues;
	title: string;
	stopAt: number | null;
};

/**
 * Checks a run before anything is written, in the order the person sees
 * the refusals: the flow and its called flows parse and validate; the
 * profiles exist (the run's copy holds them as they are now); every
 * `REQUIREMENTS` entry passes; the stop time is ahead; the inputs resolve;
 * the project folder is ready. Throws the refusal, returns the prepared run.
 */
export async function prepareRun(
	input: StartRunInput,
	deps: PrepareRunDeps,
): Promise<PreparedRun> {
	const projectRow = await deps.projectRow(input.projectId);
	const loaded = await flowsForRun(projectRow.repoPath, input);
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
	const refusal = refusalOf(nodes, capabilitiesFor(nodes, deps.device));
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
	const readiness = await checkProjectFolder(projectRow.repoPath, {
		...(deps.probeGit ? { probeGit: deps.probeGit } : {}),
	});
	const notReady = readiness.steps.find(
		(step) => step.status === "failed" && step.id !== "identity",
	);
	if (notReady) {
		throw new Error(
			`The project is not ready for runs. ${notReady.problem} ${
				notReady.id === "git"
					? "Install git, then start the run again."
					: "Add the project again to fix it."
			}`,
		);
	}
	return {
		projectRow,
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
			const prepared = await prepareRun(input, deps);
			const { projectRow, flow, flowName, calledFlows, inputs, title } =
				prepared;
			const worktree = await deps.device.worktree({
				id: runId,
				repoPath: projectRow.repoPath,
				...(input.baseRef !== undefined ? { baseRef: input.baseRef } : {}),
			});
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
					walkerId: await log.walkerId(),
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
				},
			});
			await log.append({
				type: "WorktreeCreated",
				runId,
				payload: worktree,
			});
			runner.start(row, inputs, prepared.stopAt);
			return toSummary(row, runFacts(await log.events(runId)));
		} finally {
			runner.releaseStartingSlot(runId);
		}
	}

	return { start };
}
