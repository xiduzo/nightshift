import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { systemGit } from "../../../../git";
import { cloneFoldersContract } from "./clone-folders.contract";
import { fsCloneFolders } from "./fs-clone-folders";
import { inMemoryCloneFolders } from "./in-memory-clone-folders";

cloneFoldersContract("disk and git", async () => {
	const git = systemGit();
	const repoPath = await mkdtemp(join(tmpdir(), "nightshift-clone-folders-"));
	await git.run(repoPath, ["init", "-q"]);
	const root = join(repoPath, ".nightshift");
	const filesOf = async (folder: string): Promise<string[]> => {
		const entries = await readdir(folder, { withFileTypes: true });
		const nested = await Promise.all(
			entries.map((entry) =>
				entry.isDirectory()
					? filesOf(join(folder, entry.name))
					: [relative(root, join(folder, entry.name))],
			),
		);
		return nested.flat();
	};
	return {
		folders: fsCloneFolders({ git }),
		repoPath,
		async write(path, text) {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), text);
		},
		async track(paths) {
			await git.run(repoPath, [
				"add",
				"--",
				...paths.map((path) => join(".nightshift", path)),
			]);
		},
		async files() {
			try {
				return (await filesOf(root)).sort();
			} catch {
				return null;
			}
		},
		close: () => rm(repoPath, { recursive: true, force: true }),
	};
});

cloneFoldersContract("in memory", async () => {
	const folders = inMemoryCloneFolders();
	const repoPath = "/repos/one";
	return {
		folders,
		repoPath,
		async write(path, text) {
			folders.write(repoPath, path, text);
		},
		async track(paths) {
			folders.track(repoPath, paths);
		},
		async files() {
			const files = folders.files(repoPath);
			return files ? Object.keys(files).sort() : null;
		},
		close: async () => {},
	};
});
