import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { type FileHandle, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { TranscriptEntry } from "./step-events";

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

/**
 * The transcript file of a step to read on this computer. This computer
 * writes a step's transcript at `transcriptPath` under its own data
 * folder, also for a step another Walker started. The path in the step's
 * row names the data folder of the Walker that started the step: after
 * "Move to …" that is another computer's. A file that is only at the
 * row's path on this disk (a run moved before this rule) is read there.
 */
export function transcriptToRead(
	dataDir: string,
	runId: string,
	stepId: string,
	rowPath: string,
): string {
	const own = transcriptPath(dataDir, runId, stepId);
	if (rowPath === "" || rowPath === own || existsSync(own)) return own;
	return existsSync(rowPath) ? rowPath : own;
}

export function commandLogPath(
	dataDir: string,
	runId: string,
	stepId: string,
): string {
	return join(dataDir, "logs", runId, `${stepId}.log`);
}

/** A service's log: what the process of a Service step prints while it runs. */
export function serviceLogPath(
	dataDir: string,
	runId: string,
	stepId: string,
): string {
	return join(dataDir, "logs", runId, `${stepId}.service.log`);
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
	return parseTranscript(text);
}

/** How much of a transcript's end `lastEntryAt` reads first. */
const TAIL_BYTES = 64 * 1024;

/**
 * The time of a transcript's last entry, or null when it has none. Reads
 * the end of the file only, unless one entry is longer than that.
 */
export async function lastEntryAt(path: string): Promise<number | null> {
	let file: FileHandle;
	try {
		file = await open(path, "r");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	try {
		const { size } = await file.stat();
		const start = Math.max(0, size - TAIL_BYTES);
		const tail = Buffer.alloc(size - start);
		await file.read(tail, 0, tail.length, start);
		let text = tail.toString("utf8");
		// The tail starts inside an entry: its first line is cut.
		if (start > 0) text = text.slice(text.indexOf("\n") + 1);
		const last = parseTranscript(text).at(-1);
		if (last || start === 0) return last?.at ?? null;
	} finally {
		await file.close();
	}
	return (await readTranscriptFile(path)).at(-1)?.at ?? null;
}

/** The entries of a transcript's text. A line that does not parse is skipped. */
export function parseTranscript(text: string): TranscriptEntry[] {
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
