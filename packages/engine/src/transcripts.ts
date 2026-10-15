import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { TranscriptEntry } from "./types";

/**
 * Transcripts are NDJSON files on disk, one per step:
 * `<dataDir>/transcripts/<runId>/<stepId>.ndjson`. `seq` increases by one
 * per run, across steps and sessions. A command step also keeps its full
 * output as plain text in `<dataDir>/logs/<runId>/<stepId>.log`.
 */

export function transcriptPath(
	dataDir: string,
	runId: string,
	stepId: string,
): string {
	return join(dataDir, "transcripts", runId, `${stepId}.ndjson`);
}

export function commandLogPath(
	dataDir: string,
	runId: string,
	stepId: string,
): string {
	return join(dataDir, "logs", runId, `${stepId}.log`);
}

/**
 * Reads one transcript file. A missing file is empty. A line that does not
 * parse (a write cut short by a crash, or a write in progress) is skipped.
 */
export async function readTranscriptFile(
	path: string,
): Promise<TranscriptEntry[]> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const entries: TranscriptEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line) continue;
		try {
			const entry = JSON.parse(line) as TranscriptEntry;
			if (typeof entry.seq === "number") entries.push(entry);
		} catch {
			// Skip a torn line.
		}
	}
	return entries;
}

/** All entries of a run, over all its steps, ordered by seq. */
export async function readRunTranscript(
	paths: readonly string[],
): Promise<TranscriptEntry[]> {
	const files = await Promise.all(paths.map(readTranscriptFile));
	return files.flat().sort((a, b) => a.seq - b.seq);
}

/**
 * An append-only writer. Each entry is one synchronous write, so an entry is
 * on disk before the engine publishes it on the bus. `watchRun` relies on
 * that to replay from disk without gaps.
 */
export function openTranscriptWriter(path: string) {
	mkdirSync(dirname(path), { recursive: true });
	let fd: number | null = openSync(path, "a");
	return {
		append(entry: TranscriptEntry): void {
			if (fd === null) throw new Error(`Transcript ${path} is closed.`);
			writeSync(fd, `${JSON.stringify(entry)}\n`);
		},
		close(): void {
			if (fd === null) return;
			closeSync(fd);
			fd = null;
		},
	};
}

export type TranscriptWriter = ReturnType<typeof openTranscriptWriter>;
