import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderProjectFactsReader } from "./folder-project-facts-reader";
import { inMemoryProjectFactsReader } from "./in-memory-project-facts-reader";
import { projectFactsReaderContract } from "./project-facts-reader.contract";

/** The contract of `ProjectFactsReader`, on both adapters. */

projectFactsReaderContract("in memory", async () => ({
	read: inMemoryProjectFactsReader({
		"/repo": {
			packageManager: "pnpm",
			scripts: { lint: "biome check" },
			taskFiles: ["Makefile"],
		},
	}),
	folder: "/repo",
	close: async () => {},
}));

projectFactsReaderContract("over a folder", async () => {
	const folder = await mkdtemp(join(tmpdir(), "ns-facts-"));
	await writeFile(join(folder, "pnpm-lock.yaml"), "");
	await writeFile(join(folder, "Makefile"), "");
	await writeFile(
		join(folder, "package.json"),
		// A script that is no text is left out.
		JSON.stringify({ scripts: { lint: "biome check", bad: 1 } }),
	);
	return {
		read: folderProjectFactsReader,
		folder,
		close: () => rm(folder, { recursive: true, force: true }),
	};
});
