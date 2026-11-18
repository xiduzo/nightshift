import { projectPath } from "@nightshift/client";

/** The fields of a tool's input that hold a file or folder path. */
const PATH_FIELDS = new Set([
	"file_path",
	"filePath",
	"path",
	"notebook_path",
	"absolute_path",
]);

/**
 * A one-line summary of a tool's input: the command, path, or pattern it
 * acts on. A path inside the project shows relative to `root`, the
 * project's folder. A search of the whole project names its pattern.
 */
export function summarizeToolInput(input: unknown, root?: string): string {
	if (input == null) return "";
	if (typeof input === "string") return input;
	if (typeof input !== "object") return String(input);
	const record = input as Record<string, unknown>;
	let atRoot = false;
	for (const field of [
		"command",
		"file_path",
		"filePath",
		"path",
		"notebook_path",
		"absolute_path",
		"pattern",
		"url",
		"query",
		"description",
		"prompt",
	]) {
		const value = record[field];
		if (typeof value !== "string" || value.length === 0) continue;
		if (!PATH_FIELDS.has(field)) return value;
		const path = projectPath(value, root);
		if (path !== "") return path;
		atRoot = true;
	}
	// The input names the project's folder and nothing else.
	if (atRoot) return ".";
	try {
		return JSON.stringify(input);
	} catch {
		return "";
	}
}

export function formatToolInput(input: unknown): string {
	if (typeof input === "string") return input;
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}
