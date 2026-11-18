/**
 * The slices of the server packages, and the shape of a slice.
 * `scripts/check-rings.ts` says what "in shape" means. This module finds
 * the slices from the file system and names what breaks the shape.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { SERVER_PACKAGES } from "../../.dependency-cruiser.mjs";
import { isTest } from "../check-layers";
import { parse, skipped } from "../verticals/source-file";
import { verticalsOf } from "../verticals/vertical";

/** The folders of a slice that are rings. */
export const RINGS = new Set(["domain", "application", "adapters"]);

/** The files of a slice's own folder, besides its tests. */
const ROOT_FILES = new Set(["index.ts", "wire.ts"]);

/** The folders of `adapters/`: the driving and the driven side. */
const ADAPTER_SIDES = new Set(["in", "out"]);

export type Slice = {
	/** Its package: `engine`. */
	pkg: string;
	/** Its path in `src/`: `schedules`, or `flows/editing` for a sub-vertical. */
	path: string;
	dir: string;
	/** Its sub-verticals: the folders in it with their own `index.ts`. */
	subs: Slice[];
};

type Entry = { name: string; file: boolean; dir: boolean };

/** What a folder holds, in name order, without dot files and installs. */
function entriesOf(dir: string): Entry[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => !skipped(entry.name))
		.map((entry) => ({
			name: entry.name,
			file: entry.isFile(),
			dir: entry.isDirectory(),
		}))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const foldersOf = (dir: string) => entriesOf(dir).filter((e) => e.dir);

function sliceAt(pkg: string, path: string, dir: string): Slice {
	const subs = foldersOf(dir)
		.filter(
			(folder) =>
				!RINGS.has(folder.name) &&
				existsSync(join(dir, folder.name, "index.ts")),
		)
		.map((folder) =>
			sliceAt(pkg, `${path}/${folder.name}`, join(dir, folder.name)),
		);
	return { pkg, path, dir, subs };
}

/**
 * Every vertical of the server packages under `root`, as a slice with its
 * sub-verticals, in name order. A vertical is a folder directly in `src/`,
 * except `testing/` (as in `scripts/check-verticals.ts`).
 */
export function slicesOf(root: string): Slice[] {
	const found: Slice[] = [];
	for (const pkg of [...SERVER_PACKAGES].sort()) {
		const src = join(root, "packages", pkg, "src");
		if (!existsSync(src)) continue;
		const verticals = verticalsOf(src, false).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		);
		for (const vertical of verticals)
			found.push(sliceAt(pkg, vertical.name, vertical.dir));
	}
	return found;
}

/** A slice and its sub-verticals, at every depth. */
export function withSubs(slice: Slice): Slice[] {
	return [slice, ...slice.subs.flatMap(withSubs)];
}

/** The slice, or one of its sub-verticals, has an `application/` folder. */
export function hasApplication(slice: Slice): boolean {
	return withSubs(slice).some((s) => existsSync(join(s.dir, "application")));
}

/** The folders named like a ring below `dir`, at any depth. */
function ringNamesBelow(dir: string): string[] {
	const found: string[] = [];
	for (const folder of foldersOf(dir)) {
		const path = join(dir, folder.name);
		if (RINGS.has(folder.name)) found.push(path);
		found.push(...ringNamesBelow(path));
	}
	return found;
}

/**
 * What keeps a slice out of shape, its sub-verticals included, as messages.
 * `root` is the repository root.
 */
export function shapeProblems(root: string, slice: Slice): string[] {
	const rel = (path: string) => relative(root, path).split(sep).join("/");
	const here = rel(slice.dir);
	const problems: string[] = [];
	const entries = entriesOf(slice.dir);

	const loose = entries.filter(
		(e) => e.file && !ROOT_FILES.has(e.name) && !isTest(e.name),
	);
	if (loose.length) {
		const names = loose.slice(0, 5).map((e) => e.name);
		if (loose.length > names.length) names.push("…");
		problems.push(
			`${here}/: ${loose.length} file${loose.length === 1 ? "" : "s"} in the slice besides index.ts, wire.ts and tests (${names.join(", ")}). A slice holds only those, its rings (domain/, application/, adapters/) and its sub-verticals. Move each file into a ring.`,
		);
	}

	const subs = new Set(slice.subs.map((sub) => sub.dir));
	for (const folder of entries.filter((e) => e.dir)) {
		const path = join(slice.dir, folder.name);
		if (RINGS.has(folder.name) || subs.has(path)) continue;
		problems.push(
			`${rel(path)}/: a folder of a slice is a ring (domain/, application/, adapters/) or a sub-vertical with its own index.ts.`,
		);
	}

	const has = (ring: string) => existsSync(join(slice.dir, ring));
	if (!has("domain") && !has("application") && !slice.subs.length) {
		problems.push(
			`${here}/: has no domain/ and no application/. A slice has at least one of them, or sub-verticals that do.`,
		);
	}

	// A slice of rules alone: `domain/` and its barrel, nothing more.
	if (!has("application")) {
		if (has("adapters")) {
			problems.push(
				`${here}/adapters/: a slice without application/ has no adapters/. An adapter fills a port of application/ports.ts or drives a use case, and this slice has neither. A slice of rules alone holds domain/ and its barrel.`,
			);
		}
		const barrel = join(slice.dir, "index.ts");
		const outside = existsSync(barrel)
			? parse(barrel)
					.imports.map((imported) => imported.specifier)
					.filter((specifier) => !specifier.startsWith("./"))
			: [];
		for (const specifier of [...new Set(outside)].sort()) {
			problems.push(
				`${rel(barrel)}: passes on "${specifier}". The barrel of a slice without application/ passes on only what the slice holds: the rules of its domain/ and its sub-verticals. A type counts too.`,
			);
		}
	}

	const adapters = join(slice.dir, "adapters");
	const stray = entriesOf(adapters).filter(
		(e) => !(e.dir && ADAPTER_SIDES.has(e.name)),
	);
	if (stray.length) {
		problems.push(
			`${rel(adapters)}/: holds only out/ (the driven adapters) and in/ (the driving ones), but it has ${stray.map((e) => e.name).join(", ")}.`,
		);
	}

	const application = join(slice.dir, "application");
	for (const folder of foldersOf(application)) {
		problems.push(
			`${rel(join(application, folder.name))}/: application/ is flat. It holds ports.ts, one file per use case and its test.`,
		);
	}

	for (const ring of ["domain", "adapters/in", "adapters/out"]) {
		for (const path of ringNamesBelow(join(slice.dir, ring))) {
			problems.push(
				`${rel(path)}/: a folder named like a ring inside a ring. Name it for what it holds.`,
			);
		}
	}

	for (const sub of slice.subs) problems.push(...shapeProblems(root, sub));
	return problems;
}
