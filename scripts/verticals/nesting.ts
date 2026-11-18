/**
 * Rules (o) and (p) of `scripts/check-verticals.ts`: sub-verticals.
 *
 * A folder inside a vertical that has its own `index.ts` is a sub-vertical,
 * at every depth. The barrel rules of a vertical hold for it too (o):
 * - code outside the sub-vertical imports it only through its `index.ts`.
 *   Inside it, files reach each other freely. From another vertical, rule
 *   (a) decides: that import goes through the barrel of the vertical
 * - its barrel holds only import and export statements
 * - every name on its barrel has an importer outside the sub-vertical.
 *   A barrel that `package.json` `exports` names is a public entry
 * Tests may deep-import, and they do not count as importers.
 *
 * A vertical or a sub-vertical that holds more than MAX_FILES source files
 * or more than MAX_LINES lines, tests apart and everything below it
 * counted, must consist of sub-verticals (p):
 * - each folder directly in it that holds a source file has an `index.ts`
 * - its own code is within the same two limits. Its own code is the files
 *   directly in it and in its ring folders
 *
 * The ring folders of the hexagon (`domain/`, `application/`, `adapters/`,
 * `adapters/in/` and `adapters/out/`, directly in a vertical or a
 * sub-vertical) are not sub-verticals. They need no barrel, an `index.ts`
 * in one makes no barrel, and a folder in one counts as a folder directly
 * in the vertical. The ring checks decide what a ring may import.
 *
 * What is a test comes from `isTest` of check-layers, through the `test`
 * mark of each file. So the counts follow that one definition.
 */

import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import type { Finding } from "./debt";
import { resolveFile } from "./resolve";
import { type SourceFile, skipped } from "./source-file";
import type { Vertical } from "./vertical";

/** A vertical or a sub-vertical over one of these must split (p). */
export const MAX_FILES = 25;
export const MAX_LINES = 5000;

/** The ring folders directly in a vertical or a sub-vertical. */
const RINGS = new Set(["domain", "application", "adapters"]);
/** The ring folders directly in `adapters/`. */
const ADAPTER_RINGS = new Set(["in", "out"]);
const NO_RINGS = new Set<string>();

type Size = { files: number; lines: number };

/** A vertical, or a sub-vertical of it. */
type Unit = {
	/** Its path in `src/`: `features/flows`, `features/flows/editor`. */
	name: string;
	dir: string;
	barrel?: string;
	/** The vertical or sub-vertical that holds it. A vertical has none. */
	parent?: Unit;
	/** Its ring folders. */
	rings: Set<string>;
	/** The folders directly in it, or in a ring folder, with no barrel. */
	plain: string[];
	/** Its source files, tests apart, with everything below it. */
	total: Size;
	/** The same, for the files directly in it and in its ring folders. */
	own: Size;
};

export type Workspace = {
	verticals: Vertical[];
	/** Every file of the workspace, each marked as a test or not. */
	files: Map<string, SourceFile>;
	/** The files that `package.json` `exports` names. */
	entries: Set<string>;
	resolveImport: (from: string, specifier: string) => string | undefined;
	/** The names a barrel exports, through its `export *` too. */
	exportsOf: (path: string) => string[];
	/** A path from the repository root, for a message. */
	rel: (path: string) => string;
};

const inside = (dir: string, path: string) => path.startsWith(`${dir}${sep}`);
const over = (size: Size) => size.files > MAX_FILES || size.lines > MAX_LINES;
const count = (size: Size) =>
	`${size.files} source files and ${size.lines} lines`;

/** The vertical and its sub-verticals, each before the ones it holds. */
function unitsOf(vertical: Vertical, files: Workspace["files"]): Unit[] {
	const units: Unit[] = [];
	const folders = (dir: string) =>
		readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && !skipped(entry.name))
			.map((entry) => entry.name)
			.sort();
	/** The barrel of a folder. A test helper (`testing/index.ts`) is none. */
	const barrelOf = (dir: string) => {
		const barrel = resolveFile(join(dir, "index"));
		return barrel && files.get(barrel)?.test === false ? barrel : undefined;
	};
	const add = (dir: string, barrel?: string, parent?: Unit): void => {
		const path = relative(vertical.dir, dir).split(sep).join("/");
		const unit: Unit = {
			name: path ? `${vertical.name}/${path}` : vertical.name,
			dir,
			barrel,
			parent,
			rings: new Set(),
			plain: [],
			total: { files: 0, lines: 0 },
			own: { files: 0, lines: 0 },
		};
		units.push(unit);
		direct(dir, unit, RINGS);
	};
	/** The folders directly in a unit, or in one of its ring folders. */
	const direct = (dir: string, unit: Unit, rings: Set<string>): void => {
		for (const name of folders(dir)) {
			const path = join(dir, name);
			if (rings.has(name)) {
				unit.rings.add(path);
				direct(path, unit, name === "adapters" ? ADAPTER_RINGS : NO_RINGS);
				continue;
			}
			const barrel = barrelOf(path);
			if (barrel) add(path, barrel, unit);
			else {
				unit.plain.push(path);
				below(path, unit);
			}
		}
	};
	/** Below a folder with no barrel, a folder with a barrel is a sub-vertical. */
	const below = (dir: string, unit: Unit): void => {
		for (const name of folders(dir)) {
			const path = join(dir, name);
			const barrel = barrelOf(path);
			if (barrel) add(path, barrel, unit);
			else below(path, unit);
		}
	};
	add(vertical.dir, vertical.barrel);
	return units;
}

/**
 * (o) and (p) What breaks the sub-vertical rules in one workspace, each
 * with its line for `scripts/nesting-debt.txt`:
 * - `<file> -> <sub-vertical>`: the file imports past that barrel
 * - `<barrel> holds code`: a statement that is not an import or an export
 * - `<barrel> exports <name>`: a name with no importer outside
 * - `<folder>`: a folder with no `index.ts` in a vertical or sub-vertical
 *   that must split, or a vertical or sub-vertical whose own code is over
 *   the limits
 */
export function nestingFindings(workspace: Workspace): Finding[] {
	const { files, resolveImport, rel } = workspace;
	const units = [...workspace.verticals]
		.sort((a, b) => (a.dir < b.dir ? -1 : 1))
		.flatMap((vertical) => unitsOf(vertical, files));

	/** The innermost vertical or sub-vertical that holds a file. */
	const homes = new Map<string, Unit | undefined>();
	const homeOf = (path: string): Unit | undefined => {
		const dir = dirname(path);
		if (!homes.has(dir)) {
			let home: Unit | undefined;
			for (const unit of units)
				if (inside(unit.dir, path) && unit.dir.length > (home?.dir.length ?? 0))
					home = unit;
			homes.set(dir, home);
		}
		return homes.get(dir);
	};

	const used = new Map<string, Set<string> | "all">();
	const markUsed = (barrel: string, names: string[] | "all") => {
		const current = used.get(barrel);
		if (current === "all") return;
		if (names === "all") {
			used.set(barrel, "all");
			return;
		}
		const set = current ?? new Set<string>();
		for (const name of names) set.add(name);
		used.set(barrel, set);
	};

	const found: Finding[] = [];
	const deep = new Set<string>();
	for (const file of files.values()) {
		if (file.test) continue;
		const home = homeOf(file.path);
		for (let unit = home; unit; unit = unit.parent) {
			unit.total.files += 1;
			unit.total.lines += file.lines;
		}
		if (
			home &&
			(dirname(file.path) === home.dir || home.rings.has(dirname(file.path)))
		) {
			home.own.files += 1;
			home.own.lines += file.lines;
		}

		// (o) An import past the barrel of a sub-vertical of its own vertical.
		for (const imported of file.imports) {
			const target = resolveImport(file.path, imported.specifier);
			const to = target ? homeOf(target) : undefined;
			if (!target || !to) continue;
			// The outermost sub-vertical of the target that does not hold the
			// file. A vertical is none: rule (a) guards its barrel.
			let gate: Unit | undefined;
			let vertical = to;
			for (; vertical.parent; vertical = vertical.parent)
				if (!inside(vertical.dir, file.path)) gate = vertical;
			if (!gate || !inside(vertical.dir, file.path)) continue;
			if (target === gate.barrel) {
				markUsed(target, imported.names);
				continue;
			}
			const line = `${rel(file.path)} -> ${rel(gate.dir)}`;
			if (deep.has(line)) continue;
			deep.add(line);
			const barrel = relative(dirname(file.path), gate.dir)
				.split(sep)
				.join("/");
			found.push({
				line,
				message: `${rel(file.path)}: imports "${imported.specifier}" past the barrel of ${gate.name}, a sub-vertical. Import "${barrel.startsWith(".") ? barrel : `./${barrel}`}" instead.`,
			});
		}
	}

	for (const unit of units) {
		// (o) The barrel of a sub-vertical: only imports and exports, and
		// every name has an importer outside the sub-vertical.
		if (unit.parent && unit.barrel) {
			const barrel = rel(unit.barrel);
			if (files.get(unit.barrel)?.onlyImportsAndExports === false) {
				found.push({
					line: `${barrel} holds code`,
					message: `${barrel}: a barrel holds only import and export statements. Move the code into a file of ${unit.name} and export it from there.`,
				});
			}
			const uses = used.get(unit.barrel);
			if (uses !== "all" && !workspace.entries.has(unit.barrel)) {
				const names = [...new Set(workspace.exportsOf(unit.barrel))].sort();
				for (const name of names.filter((name) => !uses?.has(name))) {
					found.push({
						line: `${barrel} exports ${name}`,
						message: `${barrel}: nothing outside ${unit.name} imports "${name}". Take it off the barrel.`,
					});
				}
			}
		}

		// (p) A vertical or a sub-vertical over the limits consists of
		// sub-verticals.
		if (!over(unit.total)) continue;
		const kind = unit.parent ? "sub-vertical" : "vertical";
		if (over(unit.own)) {
			found.push({
				line: rel(unit.dir),
				message: `${rel(unit.dir)}/: the ${kind} ${unit.name} holds ${count(unit.own)} of its own, outside a sub-vertical. The limit is ${MAX_FILES} source files and ${MAX_LINES} lines (tests do not count). Split it into sub-verticals by sub-domain: folders with their own index.ts.`,
			});
		}
		for (const folder of unit.plain) {
			const holdsSource = [...files.values()].some(
				(file) => !file.test && inside(folder, file.path),
			);
			if (!holdsSource) continue;
			found.push({
				line: rel(folder),
				message: `${rel(folder)}/: has no index.ts. The ${kind} ${unit.name} holds ${count(unit.total)}, over the limit of ${MAX_FILES} source files and ${MAX_LINES} lines (tests do not count). So each folder in it is a sub-vertical: add a barrel that exports what the rest of ${unit.name} uses.`,
			});
		}
	}
	return found;
}
