/**
 * Which project a tool in a terminal works in (`nightshift mcp`,
 * `nightshift flows`): the one named by id, name or folder, else the one
 * whose Clone holds the folder the command runs in, else the only one.
 */

/** A project of the Space. `path`: its Clone on this computer, or null. */
export type TerminalProject = { id: string; name: string; path: string | null };

/** The project a terminal command works in, or why there is none. */
export type ProjectChoice =
	| { kind: "found"; project: TerminalProject }
	/** No project has the id, name or folder that was named. */
	| { kind: "unknown"; wanted: string }
	/** Night Shift has no projects. */
	| { kind: "none" }
	/** Several projects, and none holds the folder: name one. */
	| { kind: "ambiguous" };

const trimSlash = (path: string) => path.replace(/[/\\]+$/, "");

/** `folder` is `root` or inside it. */
function within(folder: string, root: string): boolean {
	const f = trimSlash(folder);
	const r = trimSlash(root);
	return f === r || f.startsWith(`${r}/`) || f.startsWith(`${r}\\`);
}

/** The project whose Clone holds `folder`: the deepest one. */
export function projectOfFolder(
	projects: TerminalProject[],
	folder: string,
): TerminalProject | undefined {
	return projects
		.filter((p) => p.path !== null && within(folder, p.path))
		.sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];
}

/** The project an id, a name or a folder names. */
function match(
	projects: TerminalProject[],
	wanted: string,
): TerminalProject | undefined {
	const byId = projects.find((p) => p.id === wanted);
	if (byId) return byId;
	const named = projects.filter(
		(p) => p.name.toLowerCase() === wanted.toLowerCase(),
	);
	if (named.length === 1) return named[0];
	return projectOfFolder(projects, wanted);
}

/**
 * The project `wanted` (an id, a name or a folder) names. Without one: the
 * project whose Clone holds `folder`, else the only project.
 */
export function chooseProject(
	projects: TerminalProject[],
	wanted: string | null,
	folder: string | null,
): ProjectChoice {
	const named = wanted?.trim() || null;
	if (named) {
		const found = match(projects, named);
		return found
			? { kind: "found", project: found }
			: { kind: "unknown", wanted: named };
	}
	const here = folder ? projectOfFolder(projects, folder) : undefined;
	if (here) return { kind: "found", project: here };
	if (projects.length === 1 && projects[0]) {
		return { kind: "found", project: projects[0] };
	}
	return projects.length === 0 ? { kind: "none" } : { kind: "ambiguous" };
}
