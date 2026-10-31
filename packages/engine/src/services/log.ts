import { closeSync, openSync, readSync, statSync } from "node:fs";

/** How much of the end of a service's log a read gives. */
const LOG_READ_BYTES = 64 * 1024;

/**
 * The end of a service's log, at most 64 KB, or null when this computer
 * has no such file (the run is walked on another computer, or the
 * service printed nothing yet).
 */
export function readServiceLog(path: string): string | null {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return null;
	}
	try {
		const size = statSync(path).size;
		const length = Math.min(size, LOG_READ_BYTES);
		const buffer = Buffer.alloc(length);
		readSync(fd, buffer, 0, length, size - length);
		return buffer.toString("utf8").replace(/^\uFFFD+/, "");
	} finally {
		closeSync(fd);
	}
}
