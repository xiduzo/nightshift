import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { migrateFlow } from "./migrate";
import {
	SCHEDULES_VERSION,
	type Schedule,
	type ScheduleFlowInfo,
	type ScheduleIssue,
	schedulesFileSchema,
	validateSchedules,
} from "./schedules";
import { FLOW_VERSION, type Flow, flowNameSchema, flowSchema } from "./schema";
import type { FlowIssue, FlowListItem, LoadedFlow } from "./types";
import { parseFlow } from "./validate";

/**
 * Node-only: reads and writes `.nightshift/flows/*.json` and
 * `.nightshift/schedules.json` in a repo. Not
 * exported from the index. Reading migrates older versions in memory
 * (`migrateFlow`); the file on disk changes only when it is written.
 */

export function flowsDir(repoPath: string): string {
	return join(repoPath, ".nightshift", "flows");
}

/** All flow files, sorted by name. A missing directory is an empty list. */
export async function listFlowFiles(repoPath: string): Promise<FlowListItem[]> {
	return listFlowSources(await readAll(repoPath), repoPath);
}

/**
 * What one flow file holds, as plain data that can cross a wire: its
 * parsed JSON, or why it is not JSON.
 */
export type FlowSource = { json: unknown } | { jsonError: string };

/** Every flow file of a repo by name (valid names only, sorted). A missing directory is none. */
export type FlowSources = Record<string, FlowSource>;

/**
 * The flow files of a repo as they are on disk, unparsed: what a Device
 * hands the Walker of a run placed on it, which reads them with
 * `listFlowSources`, `loadFlowSource` and `parsedFlows`.
 */
export async function readFlowSources(repoPath: string): Promise<FlowSources> {
	return Object.fromEntries(await readAll(repoPath));
}

/**
 * The list of `listFlowFiles`, from sources read elsewhere. `repoPath` is
 * where the paths point: a Clone on another Device has a path there only.
 */
export function listFlowSources(
	sources: FlowSources | ReadonlyMap<string, FlowSource>,
	repoPath: string,
): FlowListItem[] {
	const files = asMap(sources);
	const flows = flowsOf(files);
	const items: FlowListItem[] = [];
	for (const [name, file] of files) {
		const loaded = loadedFlow(repoPath, name, file, flows);
		items.push({
			name: loaded.name,
			path: loaded.path,
			description: loaded.flow?.description ?? null,
			nodeCount: loaded.flow?.nodes.length ?? null,
			errorCount: loaded.issues.filter((issue) => issue.severity === "error")
				.length,
		});
	}
	return items;
}

/** `readFlowFile`, from sources read elsewhere. Fails when there is no such flow. */
export function loadFlowSource(
	sources: FlowSources,
	name: string,
	repoPath: string,
): LoadedFlow {
	const files = asMap(sources);
	const file = files.get(name);
	if (file === undefined) throw notFound(name);
	return loadedFlow(repoPath, name, file, flowsOf(files));
}

/** Every source as a flow, null when it does not parse (`ValidateOptions.flows`). */
export function parsedFlows(sources: FlowSources): Record<string, Flow | null> {
	return flowsOf(asMap(sources));
}

function asMap(
	sources: FlowSources | ReadonlyMap<string, FlowSource>,
): ReadonlyMap<string, FlowSource> {
	return sources instanceof Map
		? sources
		: new Map(
				Object.entries(sources as FlowSources).sort(([a], [b]) =>
					a < b ? -1 : a > b ? 1 : 0,
				),
			);
}

/**
 * Every flow file of the repo by name, null when it does not parse. For
 * `ValidateOptions.flows`. A missing directory is an empty record.
 */
export async function loadAllFlows(
	repoPath: string,
): Promise<Record<string, Flow | null>> {
	return flowsOf(await readAll(repoPath));
}

/**
 * Fails when the file does not exist. A file that is not valid JSON loads with
 * flow null. Called flows are checked against the repo's other flow files.
 */
export async function readFlowFile(
	repoPath: string,
	name: string,
): Promise<LoadedFlow> {
	const path = flowPath(repoPath, name);
	const file = await readJson(path);
	if (file === null) throw notFound(name);
	const flows = await loadAllFlows(repoPath);
	return loadedFlow(repoPath, name, file, flows);
}

/**
 * Writes the flow as pretty JSON with a trailing newline, as the current
 * version, creating the directory. Saves flows with validation errors too
 * (drafts). Returns the issues.
 */
export async function writeFlowFile(
	repoPath: string,
	name: string,
	flow: Flow,
): Promise<FlowIssue[]> {
	const path = flowPath(repoPath, name);
	await mkdir(flowsDir(repoPath), { recursive: true });
	const current: Flow = { ...flow, version: FLOW_VERSION };
	await writeFile(path, `${JSON.stringify(current, null, "\t")}\n`, "utf8");
	return parseFlow(current, { flows: await loadAllFlows(repoPath), name })
		.issues;
}

export async function deleteFlowFile(
	repoPath: string,
	name: string,
): Promise<void> {
	const path = flowPath(repoPath, name);
	try {
		await unlink(path);
	} catch (error) {
		if (isNotFound(error)) throw notFound(name);
		throw error;
	}
}

export function schedulesPath(repoPath: string): string {
	return join(repoPath, ".nightshift", "schedules.json");
}

/** The schedules file of a repo, read. */
export type LoadedSchedules = {
	/** Absolute path of `.nightshift/schedules.json`. */
	path: string;
	/** Empty when the file is missing, is not JSON, or does not match the schema. */
	schedules: Schedule[];
	/** Problems of the file (no `scheduleId`) and of each schedule. */
	issues: ScheduleIssue[];
};

/**
 * Reads `.nightshift/schedules.json`. A missing file is no schedules. A file
 * that is not JSON or does not match the schema loads with no schedules and
 * the issues. `validate` (default true) also checks each schedule against
 * the repo's flow files; the scheduler turns it off on its ticks.
 */
export async function readSchedulesFile(
	repoPath: string,
	options: { validate?: boolean } = {},
): Promise<LoadedSchedules> {
	const path = schedulesPath(repoPath);
	const file = await readJson(path);
	if (file === null) return { path, schedules: [], issues: [] };
	if (!("json" in file)) {
		return {
			path,
			schedules: [],
			issues: [
				{ severity: "error", message: `Not valid JSON: ${file.jsonError}` },
			],
		};
	}
	const parsed = schedulesFileSchema.safeParse(file.json);
	if (!parsed.success) {
		return {
			path,
			schedules: [],
			issues: parsed.error.issues.map((issue) => ({
				severity: "error",
				message: `${issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)"}: ${issue.message}`,
			})),
		};
	}
	const schedules = parsed.data.schedules;
	const issues =
		options.validate === false
			? []
			: validateSchedules(schedules, await scheduleFlowInfos(repoPath));
	return { path, schedules, issues };
}

/**
 * Writes `.nightshift/schedules.json` as pretty JSON with a trailing newline,
 * creating the directory. Saves schedules with problems too (like flow
 * drafts). Returns the issues.
 */
export async function writeSchedulesFile(
	repoPath: string,
	schedules: readonly Schedule[],
): Promise<ScheduleIssue[]> {
	await mkdir(join(repoPath, ".nightshift"), { recursive: true });
	const file = { version: SCHEDULES_VERSION, schedules };
	await writeFile(
		schedulesPath(repoPath),
		`${JSON.stringify(file, null, "\t")}\n`,
		"utf8",
	);
	return validateSchedules(schedules, await scheduleFlowInfos(repoPath));
}

/** The inputs and the error count of every flow file, for `validateSchedules`. */
async function scheduleFlowInfos(
	repoPath: string,
): Promise<Record<string, ScheduleFlowInfo | null>> {
	const files = await readAll(repoPath);
	const flows = flowsOf(files);
	const infos: Record<string, ScheduleFlowInfo | null> = {};
	for (const [name, file] of files) {
		const loaded = loadedFlow(repoPath, name, file, flows);
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

type FileJson = FlowSource;

/** Valid flow names only, sorted. */
async function readAll(repoPath: string): Promise<Map<string, FileJson>> {
	let entries: string[];
	try {
		entries = await readdir(flowsDir(repoPath));
	} catch (error) {
		if (isNotFound(error)) return new Map();
		throw error;
	}
	const names = entries
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => entry.slice(0, -".json".length))
		.filter((name) => flowNameSchema.safeParse(name).success)
		.sort();
	const files = new Map<string, FileJson>();
	for (const name of names) {
		const file = await readJson(flowPath(repoPath, name));
		// Deleted between readdir and now: leave it out.
		if (file !== null) files.set(name, file);
	}
	return files;
}

/** Null when the file does not exist. */
async function readJson(path: string): Promise<FileJson | null> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
	try {
		return { json: JSON.parse(text) };
	} catch (error) {
		return {
			jsonError: error instanceof Error ? error.message : String(error),
		};
	}
}

function flowsOf(
	files: ReadonlyMap<string, FileJson>,
): Record<string, Flow | null> {
	const flows: Record<string, Flow | null> = {};
	for (const [name, file] of files) {
		const result =
			"json" in file ? flowSchema.safeParse(migrateFlow(file.json)) : null;
		flows[name] = result?.success ? result.data : null;
	}
	return flows;
}

function loadedFlow(
	repoPath: string,
	name: string,
	file: FileJson,
	flows: Readonly<Record<string, Flow | null>>,
): LoadedFlow {
	const path = flowPath(repoPath, name);
	if (!("json" in file)) {
		return {
			name,
			path,
			flow: null,
			issues: [
				{ severity: "error", message: `Not valid JSON: ${file.jsonError}` },
			],
		};
	}
	return { name, path, ...parseFlow(file.json, { flows, name }) };
}

/** The file path of a flow. Throws on a name that is not a valid flow name. */
function flowPath(repoPath: string, name: string): string {
	const result = flowNameSchema.safeParse(name);
	if (!result.success) {
		throw new Error(
			`Invalid flow name "${name}": ${result.error.issues[0]?.message ?? "not allowed"}`,
		);
	}
	return join(flowsDir(repoPath), `${name}.json`);
}

function notFound(name: string): Error {
	return new Error(`The flow "${name}" does not exist.`);
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
