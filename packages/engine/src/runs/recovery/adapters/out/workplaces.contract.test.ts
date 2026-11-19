import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsWorkplaces } from "./fs-workplaces";
import { inMemoryWorkplaces } from "./in-memory-workplaces";
import { workplacesContract } from "./workplaces.contract";

/** The contract of `Workplaces`, on both adapters. The real side runs in a folder of its own under the temp folder. */

workplacesContract("in memory", async () => {
	const workplaces = inMemoryWorkplaces();
	return {
		workplaces,
		async folder() {
			workplaces.folder("/work/run-1");
			return "/work/run-1";
		},
		async file() {
			workplaces.file("/work/notes.txt");
			return "/work/notes.txt";
		},
		nothing: () => "/work/gone",
		close: async () => {},
	};
});

workplacesContract("on the disk", async () => {
	const root = await mkdtemp(join(tmpdir(), "workplaces-"));
	return {
		workplaces: fsWorkplaces(),
		async folder() {
			const path = join(root, "run-1");
			await mkdir(path);
			return path;
		},
		async file() {
			const path = join(root, "notes.txt");
			await writeFile(path, "notes");
			return path;
		},
		nothing: () => join(root, "gone"),
		close: () => rm(root, { recursive: true, force: true }),
	};
});
