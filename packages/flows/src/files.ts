import type { Flow } from "./schema";
import type { FlowIssue, FlowListItem, LoadedFlow } from "./types";

/** Node-only: reads and writes `.nightshift/flows/*.json` in a repo. Not exported from the index. */

export function flowsDir(repoPath: string): string {
	throw new Error("Not implemented");
}

/** All flow files, sorted by name. A missing directory is an empty list. */
export async function listFlowFiles(repoPath: string): Promise<FlowListItem[]> {
	throw new Error("Not implemented");
}

/** Fails when the file does not exist. A file that is not valid JSON loads with flow null. */
export async function readFlowFile(
	repoPath: string,
	name: string,
): Promise<LoadedFlow> {
	throw new Error("Not implemented");
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
	throw new Error("Not implemented");
}

export async function deleteFlowFile(
	repoPath: string,
	name: string,
): Promise<void> {
	throw new Error("Not implemented");
}
