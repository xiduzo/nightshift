import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Flow, flowNameSchema, flowSchema } from "./schema";
import type { FlowIssue, FlowListItem, LoadedFlow } from "./types";
import { parseFlow } from "./validate";

/** Node-only: reads and writes `.nightshift/flows/*.json` in a repo. Not exported from the index. */

export function flowsDir(repoPath: string): string {
	return join(repoPath, ".nightshift", "flows");
}

/** All flow files, sorted by name. A missing directory is an empty list. */
export async function listFlowFiles(repoPath: string): Promise<FlowListItem[]> {
	const files = await readAll(repoPath);
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
 * flow null. For Each bodies are checked against the repo's other flow files.
 */
export async function readFlowFile(
	repoPath: string,
	name: string,
): Promise<LoadedFlow> {
	const path = flowPath(repoPath, name);
	const file = await readJson(path);
	if (file === null) throw notFound(name, path);
	const flows = await loadAllFlows(repoPath);
	return loadedFlow(repoPath, name, file, flows);
}

/**
 * Writes the flow as pretty JSON with a trailing newline, creating the
 * directory. Saves flows with validation errors too (drafts). Returns the issues.
 */
export async function writeFlowFile(
	repoPath: string,
	name: string,
	flow: Flow,
): Promise<FlowIssue[]> {
	const path = flowPath(repoPath, name);
	await mkdir(flowsDir(repoPath), { recursive: true });
	await writeFile(path, `${JSON.stringify(flow, null, "\t")}\n`, "utf8");
	return parseFlow(flow, { flows: await loadAllFlows(repoPath), name }).issues;
}

export async function deleteFlowFile(
	repoPath: string,
	name: string,
): Promise<void> {
	const path = flowPath(repoPath, name);
	try {
		await unlink(path);
	} catch (error) {
		if (isNotFound(error)) throw notFound(name, path);
		throw error;
	}
}

/** What one flow file holds: parsed JSON, or why it is not JSON. */
type FileJson = { json: unknown } | { jsonError: string };

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
		const result = "json" in file ? flowSchema.safeParse(file.json) : null;
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

function notFound(name: string, path: string): Error {
	return new Error(`Flow "${name}" not found: ${path} does not exist.`);
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
