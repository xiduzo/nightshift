import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { systemGit } from "../../../../git";
import { mustGit } from "../../../../testing/test-support";
import { normaliseRemote } from "../../../keep";
import { cloneOriginsContract } from "./clone-origins.contract";
import { gitCloneOrigins } from "./git-clone-origins";
import { inMemoryCloneOrigins } from "./in-memory-clone-origins";

/**
 * The contract of `CloneOrigins`, on both adapters. The real adapter's
 * side runs on clones in a temporary folder.
 */

cloneOriginsContract("in memory", async () => {
	const cloneOrigins = inMemoryCloneOrigins();
	cloneOrigins.set("/app", "github.com/acme/app");
	cloneOrigins.set("/other", "github.com/acme/other");
	return {
		cloneOrigins,
		paths: { app: "/app", other: "/other", none: "/none" },
		originOf: async (path) => cloneOrigins.origins.get(path) ?? null,
		close: async () => {},
	};
});

cloneOriginsContract("over git", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "ns-origins-")));
	const paths = {
		app: join(root, "app"),
		other: join(root, "other"),
		none: join(root, "none"),
	};
	for (const [path, url] of [
		[paths.app, "git@github.com:acme/app.git"],
		[paths.other, "https://github.com/acme/other.git"],
		[paths.none, null],
	] as const) {
		await mkdir(path);
		await mustGit(path, ["init", "-q", "-b", "main"]);
		if (url) await mustGit(path, ["remote", "add", "origin", url]);
	}
	return {
		cloneOrigins: gitCloneOrigins(systemGit()),
		paths,
		async originOf(path) {
			const url = await mustGit(path, ["remote", "get-url", "origin"]);
			return normaliseRemote(url);
		},
		close: () => rm(root, { recursive: true, force: true }),
	};
});
