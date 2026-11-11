import type { RunFiles } from "@/shared/api";

/**
 * Where the server gives one file of a run's folder, after its address:
 * each part of the path encoded on its own, so a `/` stays a folder.
 */
export function runFilePath(
	runId: string,
	path: string,
	download = false,
): string {
	const parts = path.split("/").map(encodeURIComponent).join("/");
	const at = `/api/runs/${encodeURIComponent(runId)}/files/${parts}`;
	return download ? `${at}?download` : at;
}

/**
 * The run's files have something to show: a file, or why none is here
 * (removed, or on another computer). An empty folder here shows nothing.
 */
export function showsRunFiles(files: RunFiles | undefined): files is RunFiles {
	return files !== undefined && (files.files.length > 0 || !files.here);
}
