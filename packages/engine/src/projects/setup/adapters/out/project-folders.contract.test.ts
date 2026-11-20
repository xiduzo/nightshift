import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { systemGit } from "../../../../git";
import { mustGit } from "../../../../testing/test-support";
import { inMemoryProjectFolders } from "./in-memory-project-folders";
import { nodeProjectFolders } from "./node-project-folders";
import { projectFoldersContract } from "./project-folders.contract";

/**
 * The contract of `ProjectFolders`, on both adapters. The real adapter's
 * side runs on folders in a temporary folder, with no global git config.
 */

projectFoldersContract("in memory", async () => {
	const projectFolders = inMemoryProjectFolders();
	projectFolders.folder("/plain");
	projectFolders.repository("/repo");
	projectFolders.subfolder("/repo/sub", "/repo");
	return {
		projectFolders,
		paths: {
			plain: "/plain",
			repo: "/repo",
			sub: "/repo/sub",
			missing: "/missing",
		},
		close: async () => {},
	};
});

projectFoldersContract("on this computer", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "ns-folders-")));
	const saved = {
		GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
		GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
	};
	process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
	process.env.GIT_CONFIG_NOSYSTEM = "1";
	await writeFile(join(root, "gitconfig"), "");
	const paths = {
		plain: join(root, "plain"),
		repo: join(root, "repo"),
		sub: join(root, "repo", "sub"),
		missing: join(root, "missing"),
	};
	await mkdir(paths.plain);
	await mkdir(paths.sub, { recursive: true });
	await mustGit(paths.repo, ["init", "-q", "-b", "main"]);
	return {
		projectFolders: nodeProjectFolders(systemGit()),
		paths,
		async close() {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			await rm(root, { recursive: true, force: true });
		},
	};
});
