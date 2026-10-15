import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Flow, flowNameSchema } from "./schema";
import type { FlowIssue, FlowListItem, LoadedFlow } from "./types";
import { parseFlow } from "./validate";

/** Node-only: reads and writes `.nightshift/flows/*.json` in a repo. Not exported from the index. */

export function flowsDir(repoPath: string): string {
	return join(repoPath, ".nightshift", "flows");
}

/** All flow files, sorted by name. A missing directory is an empty list. */
export async function listFlowFiles(repoPath: string): Promise<FlowListItem[]> {
	let entries: string[];
	try {
		entries = await readdir(flowsDir(repoPath));
	} catch (error) {
		if (isNotFound(error)) return [];
		throw error;
	}
	const names = entries
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => entry.slice(0, -".json".length))
		.filter((name) => flowNameSchema.safeParse(name).success)
		.sort();
	const items: FlowListItem[] = [];
	for (const name of names) {
		const loaded = await readFlowFile(repoPath, name);
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

/** Fails when the file does not exist. A file that is not valid JSON loads with flow null. */
export async function readFlowFile(
	repoPath: string,
	name: string,
): Promise<LoadedFlow> {
	const path = flowPath(repoPath, name);
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (isNotFound(error)) throw notFound(name, path);
		throw error;
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		return {
			name,
			path,
			flow: null,
			issues: [
				{
					severity: "error",
					message: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
		};
	}
	return { name, path, ...parseFlow(json) };
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
	return parseFlow(flow).issues;
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
