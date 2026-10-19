import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	AgentHarness,
	Decider,
	HarnessName,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { type project, run } from "@nightshift/db/schema/nightshift";
import {
	type Flow,
	type FlowIssue,
	type FlowNode,
	flowSchema,
	migrateFlow,
	parseFlow,
	resolveFlowProfiles,
	validateFlow,
} from "@nightshift/flows";
import { flowsDir } from "@nightshift/flows/files";

import type { InputValues } from "./events";
import { HARNESS_LABEL } from "./graph/context";
import type { Runner } from "./graph/runner";
import { resolveInputs } from "./inputs";
import { checkProjectFolder } from "./project-setup";
import { runFacts, toSummary } from "./read-model";
import type { RunLog } from "./run-log";
import type {
	EngineOptions,
	RunSummary,
	RunTrigger,
	StartRunInput,
} from "./types";
import { createWorktree } from "./worktrees";

/**
 * Run start: from a `StartRunInput` to a run the runner drives. Two layers
 * behind one seam:
 *
 * - `prepareRun` is the deep part. It loads and validates the flow and the
 *   flows it calls, resolves the profiles, and asks every requirement
 *   whether this daemon has what the nodes need (connections, CLI tools,
 *   harnesses, a decider). It writes nothing; a refusal is an `Error` with
 *   the message the person sees, and a pass is a `PreparedRun`.
 * - `createRunStart(deps).start` holds the slot, prepares, creates the
 *   worktree and the run row, appends `RunStarted` and `WorktreeCreated`
 *   and hands the thread to the runner.
 *
 * The requirements are one function each and listed once, in `REQUIREMENTS`,
 * in the order the person sees them. A later change can move each one onto
 * the descriptor of the node kind it is about without touching the rest.
 */

const TITLE_MAX_CHARS = 80;
const QUICK_RUN_TITLE = "Quick run";

type ProjectRow = typeof project.$inferSelect;
type ProfileFor = NonNullable<EngineOptions["profileFor"]>;

/** What this daemon has: the question every requirement asks. */
export type DaemonHas = {
	/** The harness of that name, when it is added and built. */
	harnessFor(name: HarnessName): AgentHarness | undefined;
	connectionNames(): ReadonlySet<string>;
	cliNames(): ReadonlySet<string>;
	/** Where a CLI tool is on this computer, or null. */
	findCli(name: string): string | null;
	decider: Decider | undefined;
};

/**
 * One requirement of a run's nodes on the daemon: the message that refuses
 * the run, or null when the daemon has what the nodes need.
 */
export type Requirement = (
	nodes: readonly FlowNode[],
	has: DaemonHas,
) => string | null;

/** Agent and Tool nodes name connections the daemon has. */
export const connectionsExist: Requirement = (nodes, has) => {
	const unknown = missingNames(
		nodes,
		(node) =>
			node.type === "agent"
				? (node.connections ?? [])
				: node.type === "tool"
					? [node.connection]
					: [],
		has.connectionNames(),
	);
	if (unknown.length === 0) return null;
	return unknown
		.map(
			({ name, nodeIds }) =>
				`The flow uses the connection "${name}" (${nodeIds.join(", ")}), but no connection has that name. Add it under Agents → Tools.`,
		)
		.join(" ");
};

/** Agent nodes name CLI tools the daemon defines. */
export const cliToolsDefined: Requirement = (nodes, has) => {
	const unknown = missingNames(
		nodes,
		(node) => (node.type === "agent" ? (node.clis ?? []) : []),
		has.cliNames(),
	);
	if (unknown.length === 0) return null;
	return unknown
		.map(
			({ name, nodeIds }) =>
				`The flow uses the CLI tool "${name}" (${nodeIds.join(", ")}), but no CLI tool has that name. Add it under Agents → Tools.`,
		)
		.join(" ");
};

/** Every CLI tool an Agent node uses is on this computer. */
export const cliToolsInstalled: Requirement = (nodes, has) => {
	const notFound = [
		...new Set(
			// A node's own CLI tools need no definition, but this computer must have them.
			nodes.flatMap((n) =>
				n.type === "agent" ? [...(n.clis ?? []), ...(n.nodeClis ?? [])] : [],
			),
		),
	].filter((name) => has.findCli(name) === null);
	if (notFound.length === 0) return null;
	return notFound
		.map(
			(name) =>
				`The flow uses the CLI tool "${name}", but this computer does not have it. Install ${name}, or take it off the flow.`,
		)
		.join(" ");
};

/** Agent nodes run on harnesses the daemon has added. */
export const harnessesAdded: Requirement = (nodes, has) => {
	const missing = missingHarnesses(nodes, has.harnessFor);
	if (missing.length === 0) return null;
	return missing
		.map(
			({ harness, nodeIds }) =>
				`The flow has ${nodeIds.length === 1 ? "an Agent node" : "Agent nodes"} on ${HARNESS_LABEL[harness]} (${nodeIds.join(", ")}), but no ${HARNESS_LABEL[harness]} harness is added. Add it under Agents.`,
		)
		.join(" ");
};

/** A Decision decided by a model needs the decider. */
export const modelDecisionsHaveDecider: Requirement = (nodes, has) =>
	!has.decider && nodes.some((n) => n.type === "decision" && n.by === "model")
		? "The flow has a Decision node decided by a model, but no decider is configured."
		: null;

/** An Agent node's checker needs the decider. */
export const checkersHaveDecider: Requirement = (nodes, has) =>
	!has.decider &&
	nodes.some((n) => n.type === "agent" && n.checker !== undefined)
		? "The flow has an Agent node with a checker, but no decider is configured."
		: null;

/** A Value made by a model needs a decider with a text adapter. */
export const modelValuesHaveDecider: Requirement = (nodes, has) =>
	!has.decider?.value &&
	nodes.some((n) => n.type === "value" && n.by === "model")
		? "The flow has a Value node made by a model, but no decider is configured."
		: null;

/** Every requirement, in the order a person sees them. */
export const REQUIREMENTS: readonly Requirement[] = [
	connectionsExist,
	cliToolsDefined,
	cliToolsInstalled,
	harnessesAdded,
	modelDecisionsHaveDecider,
	checkersHaveDecider,
	modelValuesHaveDecider,
];

/** The first requirement these nodes fail, as the message that refuses the run; null when all pass. */
export function refusalOf(
	nodes: readonly FlowNode[],
	has: DaemonHas,
): string | null {
	for (const requirement of REQUIREMENTS) {
		const why = requirement(nodes, has);
		if (why !== null) return why;
	}
	return null;
}

/** The harnesses the Agent nodes name that the daemon has not configured, with their nodes. */
function missingHarnesses(
	nodes: readonly FlowNode[],
	harnessFor: (name: HarnessName) => AgentHarness | undefined,
): { harness: HarnessName; nodeIds: string[] }[] {
	const missing = new Map<HarnessName, string[]>();
	for (const node of nodes) {
		if (node.type !== "agent" || node.harness === undefined) continue;
		if (harnessFor(node.harness)) continue;
		const ids = missing.get(node.harness) ?? [];
		if (!ids.includes(node.id)) ids.push(node.id);
		missing.set(node.harness, ids);
	}
	return [...missing].map(([harness, nodeIds]) => ({ harness, nodeIds }));
}

/**
 * The names the Agent nodes list (connections, CLI tools) that the daemon
 * does not have, with their nodes.
 */
function missingNames(
	nodes: readonly FlowNode[],
	listed: (node: FlowNode) => readonly string[],
	names: ReadonlySet<string>,
): { name: string; nodeIds: string[] }[] {
	const missing = new Map<string, string[]>();
	for (const node of nodes) {
		for (const name of listed(node)) {
			if (names.has(name)) continue;
			const ids = missing.get(name) ?? [];
			if (!ids.includes(node.id)) ids.push(node.id);
			missing.set(name, ids);
		}
	}
	return [...missing].map(([name, nodeIds]) => ({ name, nodeIds }));
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

/** What `prepareRun` needs: the project, the daemon's inventory, the clock. */
export type PrepareRunDeps = DaemonHas & {
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
	const refusal = refusalOf(nodes, deps);
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
			const worktree = await createWorktree({
				repoPath: projectRow.repoPath,
				shortId: runId.slice(0, 8),
				baseRef: input.baseRef,
			});
			const [row] = await db
				.insert(run)
				.values({
					id: runId,
					projectId: projectRow.id,
					flowName,
					flow: JSON.stringify(flow),
					bodyFlows: JSON.stringify(calledFlows),
					title,
					worktreePath: worktree.worktreePath,
					branch: worktree.branch,
					baseRef: worktree.baseRef,
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
