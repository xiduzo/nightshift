import type { ProjectFolders } from "../../application/ports";

/**
 * `ProjectFolders` in memory: folders, the repositories among them, their
 * commits, `.gitignore` files and git identities. A test sets them (`folder`,
 * `repository`); every change a use case makes is in `done`. Test code.
 */

export type MemoryRepository = {
	commits: number;
	identity: { name?: string; email?: string };
	gitignore: string | null;
};

export function inMemoryProjectFolders() {
	const folders = new Map<string, MemoryRepository | null>();
	/** The repository of each folder below its top: subfolder → top. */
	const inside = new Map<string, string>();
	const state = {
		gitInstalled: true,
		/** A name and email every repository has (the global config). */
		globalIdentity: false,
	};
	const done: string[] = [];
	const repo = (dir: string) => {
		const top = inside.get(dir) ?? dir;
		return folders.get(top) ?? null;
	};
	const twin = {
		state,
		done,
		folders,
		/** A plain folder. */
		folder(path: string) {
			folders.set(path, null);
		},
		/** A repository, with this many commits. */
		repository(path: string, commits = 0) {
			folders.set(path, { commits, identity: {}, gitignore: null });
		},
		/** A subfolder of the repository at `top`. */
		subfolder(path: string, top: string) {
			folders.set(path, null);
			inside.set(path, top);
		},
		async gitInstalled() {
			return state.gitInstalled;
		},
		async isDirectory(path: string) {
			return folders.has(path);
		},
		async realpath(path: string) {
			return path;
		},
		async topLevel(dir: string) {
			if (inside.has(dir)) return inside.get(dir) ?? null;
			return folders.get(dir) ? dir : null;
		},
		async hasCommit(dir: string) {
			return (repo(dir)?.commits ?? 0) > 0;
		},
		async hasIdentity(dir: string) {
			if (state.globalIdentity) return true;
			const identity = repo(dir)?.identity;
			return Boolean(identity?.name && identity.email);
		},
		async init(dir: string) {
			done.push(`init ${dir}`);
			folders.set(dir, { commits: 0, identity: {}, gitignore: null });
		},
		async setIdentity(
			dir: string,
			key: "user.name" | "user.email",
			value: string,
		) {
			done.push(`${key} ${value}`);
			const found = repo(dir);
			if (!found) throw new Error(`${dir} is not a repository.`);
			if (key === "user.name") found.identity.name = value;
			else found.identity.email = value;
		},
		async hasGitignore(dir: string) {
			return (repo(dir)?.gitignore ?? null) !== null;
		},
		async writeGitignore(dir: string, text: string) {
			done.push(`gitignore ${dir}`);
			const found = repo(dir);
			if (found) found.gitignore = text;
		},
		async commitAll(dir: string, message: string) {
			done.push(`commit ${message}`);
			const found = repo(dir);
			if (found) found.commits += 1;
		},
	};
	return twin satisfies ProjectFolders;
}

export type InMemoryProjectFolders = ReturnType<typeof inMemoryProjectFolders>;
