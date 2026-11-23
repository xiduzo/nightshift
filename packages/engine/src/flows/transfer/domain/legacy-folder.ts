/**
 * The `.nightshift/` folder of a Clone from before ADR 2: the flows in
 * `flows/<name>.json`, `schedules.json` and `profiles.json`. Only the
 * import on upgrade reads it, once per Clone. It reads the files itself,
 * so it keeps working when the flow file readers go.
 */

/** The folder's name in a Clone. The one path a notice may name. */
export const LEGACY_FOLDER = ".nightshift";

/** One file of the folder as it was read: its text, to check before it is deleted. */
export type LegacyFile = {
	/** Relative to the folder, for example `flows/build.json`. */
	path: string;
	text: string;
};

/** A JSON file of the folder: its parsed JSON, or why it is not JSON. */
export type LegacySource = { json: unknown } | { jsonError: string };

/** What the folder holds, as read. */
export type LegacyFolder = {
	/** Each flow file by its name (`build` for `flows/build.json`). */
	flows: Map<string, LegacySource>;
	schedules: LegacySource | null;
	profiles: LegacySource | null;
	/** Every file it read: the files a delete may remove. */
	files: LegacyFile[];
	/**
	 * What the import does not know, relative to the folder: another
	 * file, a folder, a link. Their presence keeps the folder.
	 */
	unknown: string[];
};

/** Files a computer leaves in a folder: they go with it. */
export const LITTER: ReadonlySet<string> = new Set([".DS_Store"]);

/** A file's text as the folder reader keeps it: its JSON, or why it is not JSON. */
export function parseJson(text: string): LegacySource {
	try {
		return { json: JSON.parse(text) };
	} catch (error) {
		return {
			jsonError: error instanceof Error ? error.message : String(error),
		};
	}
}

/** How much of the folder git tracks. */
export type TrackedState = "untracked" | "tracked" | "partial";

/**
 * How much of a Clone's folder git tracks, from the paths git lists in it
 * (relative to the Clone, `.nightshift/...`): none of its files, all of
 * them, or some. A file a computer leaves does not count.
 */
export function trackedStateOf(
	listed: readonly string[],
	folder: Pick<LegacyFolder, "files">,
): TrackedState {
	const tracked = new Set(
		listed
			.filter((path) => path.length > 0)
			.map((path) => path.slice(LEGACY_FOLDER.length + 1)),
	);
	if (tracked.size === 0) return "untracked";
	return folder.files
		.filter((file) => !LITTER.has(file.path.split("/").at(-1) ?? ""))
		.every((file) => tracked.has(file.path))
		? "tracked"
		: "partial";
}
