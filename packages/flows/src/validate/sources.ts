import { Refusal } from "@nightshift/refusal";
import {
	FLOW_VERSION,
	type Flow,
	type FlowNodeType,
	flowSchema,
	migrateFlow,
} from "../flow";
import { calledFlowNames, flowNameSchema, isProfileRef } from "../nodes";
import { nodeProfiles } from "../profiles";
import type { ScheduleFlowInfo } from "../schedules";
import { parseFlow } from "./flow";
import type {
	FlowDevices,
	FlowListItem,
	LoadedFlow,
	ProjectFlowMap,
} from "./issues";

/**
 * The flows of a project as plain data: what a Clone's flow files hold,
 * read anywhere, and what the list, the editor, a run and the schedules
 * make of them. Pure: reading them is the caller's.
 */

/**
 * What one flow holds, as plain data that can cross a wire: its parsed
 * JSON, or why it is not JSON. `revision`: the Flow revision this JSON
 * is, when Night Shift keeps the flow and it is a saved revision.
 */
export type FlowSource =
	| { json: unknown; revision?: string }
	| { jsonError: string };

/** Every flow of a project by name (valid names only, sorted). */
export type FlowSources = Record<string, FlowSource>;

/** Every flow of the sources, with its errors and the flows that call it, sorted by name. */
export function listFlowSources(sources: FlowSources): FlowListItem[] {
	const files = sorted(sources);
	const flows = flowsOf(files);
	const items: FlowListItem[] = [];
	for (const [name, file] of files) {
		const loaded = loadedFlow(name, file, flows);
		items.push({
			name: loaded.name,
			path: loaded.path,
			description: loaded.flow?.description ?? null,
			nodeCount: loaded.flow?.nodes.length ?? null,
			errorCount: loaded.issues.filter((issue) => issue.severity === "error")
				.length,
			inputs: loaded.flow?.inputs ?? [],
			callers: callersOf(name, flows),
			devices: devicesOf(name, flows),
			...nodesOf(loaded.flow),
		});
	}
	return items;
}

/**
 * One flow of the sources. A flow that is not valid JSON loads with flow
 * null. Called flows are checked against the other sources. Fails when
 * there is no such flow.
 */
export function loadFlowSource(sources: FlowSources, name: string): LoadedFlow {
	const files = sorted(sources);
	const file = files.get(name);
	if (file === undefined) {
		throw new Refusal("not-found", `The flow "${name}" does not exist.`);
	}
	return loadedFlow(name, file, flowsOf(files));
}

/** Every source as a flow, null when it does not parse (`ValidateOptions.flows`). */
export function parsedFlows(sources: FlowSources): Record<string, Flow | null> {
	return flowsOf(sorted(sources));
}

/** The inputs and the error count of every flow of the sources, for `validateSchedules`. */
export function scheduleFlowInfos(
	sources: FlowSources,
): Record<string, ScheduleFlowInfo | null> {
	const files = sorted(sources);
	const flows = flowsOf(files);
	const infos: Record<string, ScheduleFlowInfo | null> = {};
	for (const [name, file] of files) {
		if (!("json" in file)) {
			infos[name] = null;
			continue;
		}
		const loaded = parseFlow(file.json, { flows, name });
		infos[name] = loaded.flow
			? {
					inputs: loaded.flow.inputs,
					errorCount: loaded.issues.filter((i) => i.severity === "error")
						.length,
				}
			: null;
	}
	return infos;
}

/** The flows of the project that call `name` through a Call node. */
export function callersOf(name: string, flows: ProjectFlowMap): string[] {
	return Object.entries(flows)
		.filter(
			([caller, flow]) =>
				caller !== name &&
				(flow?.nodes ?? []).some(
					(node) =>
						node.type === "call" && calledFlowNames(node).includes(name),
				),
		)
		.map(([caller]) => caller)
		.sort();
}

/** A flow's nodes by type, the most first, without End nodes, and its Gates. */
function nodesOf(
	flow: Flow | null,
): Pick<FlowListItem, "nodeTypes" | "gateCount"> {
	const counts = new Map<FlowNodeType, number>();
	let gateCount = 0;
	for (const node of flow?.nodes ?? []) {
		if (node.type !== "end") {
			counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
		}
		if (node.type === "decision" && node.by === "person") gateCount += 1;
	}
	const nodeTypes = [...counts]
		.map(([type, count]) => ({ type, count }))
		.sort((a, b) => b.count - a.count);
	return { nodeTypes, gateCount };
}

/**
 * The Devices `name` and the flows it calls run on, as run start places
 * their nodes: a node's profile names its Device, else the node's
 * `device`. Each called flow counts once.
 */
export function devicesOf(name: string, flows: ProjectFlowMap): FlowDevices {
	const names = new Set<string>();
	const ids = new Set<string>();
	const seen = new Set<string>();
	const walk = (flowName: string) => {
		if (seen.has(flowName)) return;
		seen.add(flowName);
		for (const node of flows[flowName]?.nodes ?? []) {
			const profiles = nodeProfiles(node).filter(isProfileRef);
			for (const profile of profiles) ids.add(profile.device);
			if (profiles.length === 0 && "device" in node && node.device) {
				names.add(node.device);
			}
			if (node.type === "call") calledFlowNames(node).forEach(walk);
		}
	};
	walk(name);
	return { names: [...names].sort(), ids: [...ids].sort() };
}

/**
 * A flow as Night Shift saves it: the current version, as pretty JSON
 * with a trailing newline.
 */
export function canonicalFlowJson(flow: Flow): string {
	const current: Flow = { ...flow, version: FLOW_VERSION };
	return `${JSON.stringify(current, null, "\t")}\n`;
}

/** The longest flow name (`flowNameSchema`). */
const MAX_FLOW_NAME = 60;

/**
 * `name` when no flow has it, else the first free `name-2`, `name-3`, …
 * A long name is cut to make room, so the result stays a flow name
 * (`flowNameSchema`). What two flows with one name become: the second
 * gets the suffix.
 */
export function suffixedName(name: string, taken: ReadonlySet<string>): string {
	if (!taken.has(name)) return name;
	for (let n = 2; ; n++) {
		const suffix = `-${n}`;
		const base = name
			.slice(0, MAX_FLOW_NAME - suffix.length)
			.replace(/-+$/, "");
		const candidate = `${base}${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** The name an imported flow gets when its file name is no flow name. */
const FALLBACK_NAME = "imported-flow";

/**
 * The flow name a file suggests: `Build Check.json` → `build-check`. A
 * name the project has already gets a suffix when Night Shift saves it.
 */
export function flowNameOfFile(fileName: string): string {
	const name = fileName
		.replace(/\.json$/i, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/, "")
		.slice(0, MAX_FLOW_NAME)
		.replace(/-+$/, "");
	return flowNameSchema.safeParse(name).success ? name : FALLBACK_NAME;
}

function sorted(sources: FlowSources): ReadonlyMap<string, FlowSource> {
	return new Map(
		Object.entries(sources).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
	);
}

function flowsOf(
	files: ReadonlyMap<string, FlowSource>,
): Record<string, Flow | null> {
	const flows: Record<string, Flow | null> = {};
	for (const [name, file] of files) {
		const result =
			"json" in file ? flowSchema.safeParse(migrateFlow(file.json)) : null;
		flows[name] = result?.success ? result.data : null;
	}
	return flows;
}

/** A flow is no file (ADR 2): where it is, `path`, is its name. */
function loadedFlow(
	name: string,
	file: FlowSource,
	flows: Readonly<Record<string, Flow | null>>,
): LoadedFlow {
	if (!("json" in file)) {
		return {
			name,
			path: name,
			flow: null,
			issues: [
				{ severity: "error", message: `Not valid JSON: ${file.jsonError}` },
			],
		};
	}
	return { name, path: name, ...parseFlow(file.json, { flows, name }) };
}
