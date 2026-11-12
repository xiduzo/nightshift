import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { entryUnder, folderPathParts } from "../run-folders";
import type { ReadFileInput, ReadFileResult } from "./types";

/**
 * Reads one text file the run wrote in the folder it works in, on this
 * computer (`Device.readFile`): an End node's report from a file. The
 * safety of a run's files on the run page holds here too
 * (`run-folders/`): only a regular file whose real path is its path in
 * the folder, so a link an agent made never reaches outside, and never a
 * file in `.git` or a path with `..`. The file opens without following a
 * link, and only a regular file is read.
 *
 * It reads at most `maxBytes`. A longer file is cut as a report is
 * (`reportText` in `@nightshift/flows`): at the last line break within
 * the cap, else before the character the cap falls in. The bytes must be
 * UTF-8 with no NUL: anything else is not text. Never throws.
 */
export async function readFolderFile(
	input: Omit<ReadFileInput, "signal">,
): Promise<ReadFileResult> {
	const parts = folderPathParts(input.path);
	if (parts === null) return { kind: "outside" };
	const entry = await entryUnder(input.cwd, parts);
	if (entry.kind === "link") return { kind: "outside" };
	if (entry.kind !== "file") return { kind: "missing" };
	let bytes: Uint8Array;
	try {
		bytes = await readPrefix(entry.path, input.maxBytes + 1);
	} catch {
		// Swapped for a link or for something else since the check, or gone.
		return { kind: "missing" };
	}
	const cut = bytes.length > input.maxBytes;
	const kept = cut ? bytes.subarray(0, cutAt(bytes, input.maxBytes)) : bytes;
	if (kept.includes(0)) return { kind: "not-text" };
	try {
		return {
			kind: "text",
			text: new TextDecoder("utf-8", { fatal: true }).decode(kept),
			cut,
		};
	} catch {
		return { kind: "not-text" };
	}
}

/** A line feed in UTF-8: one byte, never part of a longer character. */
const LINE_FEED = 0x0a;

/**
 * Where a text longer than `max` bytes is cut: at the last line feed
 * within the cap (one right after the cap still ends a whole line), else
 * before the character the cap falls in.
 */
function cutAt(bytes: Uint8Array, max: number): number {
	const end = bytes.subarray(0, max + 1).lastIndexOf(LINE_FEED);
	if (end > 0) return end;
	let at = max;
	while (at > 0 && ((bytes[at] ?? 0) & 0xc0) === 0x80) at -= 1;
	return at;
}

/**
 * The first `limit` bytes of the regular file at `path`, or fewer when it
 * is shorter. Opens it without following a link, and without waiting on
 * anything that is not a file. Throws when it is not a regular file.
 */
async function readPrefix(path: string, limit: number): Promise<Uint8Array> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		if (!(await handle.stat()).isFile()) {
			throw new Error(`${path} is not a regular file.`);
		}
		const buffer = new Uint8Array(limit);
		let length = 0;
		while (length < limit) {
			const { bytesRead } = await handle.read(
				buffer,
				length,
				limit - length,
				length,
			);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		return buffer.subarray(0, length);
	} finally {
		await handle.close();
	}
}
