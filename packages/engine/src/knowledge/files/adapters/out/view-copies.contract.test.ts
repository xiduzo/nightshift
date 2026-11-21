import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsViewCopies } from "./fs-view-copies";
import { inMemoryViewCopies } from "./in-memory-view-copies";
import { viewCopiesContract } from "./view-copies.contract";

/** The contract of `ViewCopies`, on both adapters. The real side copies from a new folder. */

viewCopiesContract("in memory", async () => {
	const views = inMemoryViewCopies();
	views.gone.add("gone.md");
	return { viewCopies: views, source: "/knowledge/p1", close: async () => {} };
});

viewCopiesContract("over fs", async () => {
	const source = await mkdtemp(join(tmpdir(), "nightshift-source-"));
	await mkdir(join(source, "b"));
	await writeFile(join(source, "a.md"), "# A");
	await writeFile(join(source, "b", "c.md"), "# C\n\n");
	return {
		viewCopies: fsViewCopies(),
		source,
		close: () => rm(source, { recursive: true, force: true }),
	};
});
