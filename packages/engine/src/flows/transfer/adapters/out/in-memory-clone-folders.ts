import type { CloneFolders } from "../../application/ports";
import {
	type LegacyFolder,
	LITTER,
	parseJson,
	trackedStateOf,
} from "../../domain/legacy-folder";

/**
 * The `.nightshift/` folder of each Clone in memory: its files by path,
 * relative to the folder (`flows/build.json`). A path that names no flow
 * file, no `schedules.json` or `profiles.json` and no litter is `unknown`.
 */
export type InMemoryCloneFolders = CloneFolders & {
	write(repoPath: string, path: string, text: string): void;
	/** Git tracks these paths of the folder. */
	track(repoPath: string, paths: readonly string[]): void;
	/** Git cannot tell what it tracks in this Clone. */
	noGit(repoPath: string): void;
	/** The files of the folder now, by path. Null when it is gone. */
	files(repoPath: string): Record<string, string> | null;
};

export function inMemoryCloneFolders(): InMemoryCloneFolders {
	const folders = new Map<string, Map<string, string>>();
	const tracked = new Map<string, Set<string>>();
	const withoutGit = new Set<string>();
	return {
		write(repoPath, path, text) {
			const files = folders.get(repoPath) ?? new Map<string, string>();
			files.set(path, text);
			folders.set(repoPath, files);
		},
		track(repoPath, paths) {
			const set = tracked.get(repoPath) ?? new Set<string>();
			for (const path of paths) set.add(path);
			tracked.set(repoPath, set);
		},
		noGit(repoPath) {
			withoutGit.add(repoPath);
		},
		files(repoPath) {
			const files = folders.get(repoPath);
			return files ? Object.fromEntries(files) : null;
		},
		async read(repoPath) {
			const files = folders.get(repoPath);
			if (!files) return null;
			const folder: LegacyFolder = {
				flows: new Map(),
				schedules: null,
				profiles: null,
				files: [],
				unknown: [],
			};
			for (const [path, text] of [...files].sort(([a], [b]) =>
				a.localeCompare(b),
			)) {
				const parts = path.split("/");
				const name = parts.at(-1) ?? "";
				const read = () => {
					folder.files.push({ path, text });
					return parseJson(text);
				};
				if (parts.length === 1 && name === "schedules.json") {
					folder.schedules = read();
				} else if (parts.length === 1 && name === "profiles.json") {
					folder.profiles = read();
				} else if (parts.length <= 2 && LITTER.has(name)) {
					read();
				} else if (
					parts.length === 2 &&
					parts[0] === "flows" &&
					name.endsWith(".json")
				) {
					folder.flows.set(name.slice(0, -".json".length), read());
				} else {
					folder.unknown.push(parts[0] === "flows" ? path : (parts[0] ?? ""));
				}
			}
			return folder;
		},
		async tracked(repoPath, folder) {
			if (withoutGit.has(repoPath)) {
				throw new Error("git ls-files failed: not a git repository");
			}
			const paths = [...(tracked.get(repoPath) ?? [])].map(
				(path) => `.nightshift/${path}`,
			);
			return trackedStateOf(paths, folder);
		},
		async remove(repoPath, folder) {
			const files = folders.get(repoPath);
			if (!files) return true;
			let changed = false;
			for (const file of folder.files) {
				if (files.get(file.path) !== file.text) {
					changed = true;
					continue;
				}
				files.delete(file.path);
			}
			if (changed || files.size > 0) return false;
			folders.delete(repoPath);
			return true;
		},
	};
}
