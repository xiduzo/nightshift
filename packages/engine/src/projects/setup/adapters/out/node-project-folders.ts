import { realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Git, gitOrThrow } from "../../../../git";
import type { ProjectFolders } from "../../application/ports";

/**
 * `ProjectFolders` over the file system and git on this computer.
 * `wireSetup` builds it.
 */
export function nodeProjectFolders(git: Git): ProjectFolders {
	async function configValue(dir: string, key: string) {
		const result = await git.run(dir, ["config", "--get", key]);
		return result.exitCode === 0 && result.stdout ? result.stdout : null;
	}

	return {
		gitInstalled: async () => (await git.probe()) !== null,

		async isDirectory(path) {
			try {
				return (await stat(path)).isDirectory();
			} catch {
				return false;
			}
		},

		realpath: (path) => realpath(path),

		async topLevel(dir) {
			const result = await git.run(dir, ["rev-parse", "--show-toplevel"]);
			if (result.exitCode !== 0 || !result.stdout) return null;
			return realpath(result.stdout);
		},

		async hasCommit(dir) {
			const result = await git.run(dir, [
				"rev-parse",
				"--verify",
				"--quiet",
				"HEAD^{commit}",
			]);
			return result.exitCode === 0;
		},

		async hasIdentity(dir) {
			const [name, email] = await Promise.all([
				configValue(dir, "user.name"),
				configValue(dir, "user.email"),
			]);
			return name !== null && email !== null;
		},

		async init(dir) {
			await gitOrThrow(git, dir, ["init", "-q"]);
		},

		async setIdentity(dir, key, value) {
			await gitOrThrow(git, dir, ["config", key, value]);
		},

		hasGitignore: (dir) => Bun.file(join(dir, ".gitignore")).exists(),

		async writeGitignore(dir, text) {
			await writeFile(join(dir, ".gitignore"), text);
		},

		async commitAll(dir, message) {
			await gitOrThrow(git, dir, ["add", "-A"]);
			await gitOrThrow(git, dir, [
				"commit",
				"-q",
				"--allow-empty",
				"-m",
				message,
			]);
		},
	};
}
