import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsReadMarks } from "./fs-read-marks";
import { inMemoryReadMarks } from "./in-memory-read-marks";
import { readMarksContract } from "./read-marks.contract";

/** The contract of `ReadMarks`, on both adapters. The real side writes in a new data folder. */

readMarksContract("in memory", async () => {
	const marks = inMemoryReadMarks();
	return {
		marks,
		reopen: () => inMemoryReadMarks(marks.store),
		close: async () => {},
	};
});

readMarksContract("over fs", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "nightshift-read-marks-"));
	const marks = fsReadMarks(dataDir);
	return {
		marks,
		reopen: () => fsReadMarks(dataDir),
		close: async () => {
			await marks.flush();
			await rm(dataDir, { recursive: true, force: true });
		},
	};
});
