/**
 * Checks the capability rules on the capability map
 * (`scripts/capabilities.ts`). The map says of every vertical what it is:
 * a capability (a product area, named with a word of the glossary), a
 * mechanism (shared machinery), or the wiring (the piece of an app that
 * composes its capabilities).
 *
 * It finds the workspaces and their verticals as `check-verticals.ts`
 * does, and reads the imports with the same reader. It fails on:
 *
 * - V1a A vertical on disk that the map does not have, and an entry of the
 *   map that is not on disk. Also a map that cannot be right: a name that
 *   is no capability, a capability that no vertical has, a shared piece of
 *   an app that is a capability, and a capability whose word is not a term
 *   of `docs/glossary.md`. Also a wiring piece that is not the
 *   `shared/shell` of an app (so a workspace has at most one), and a wiring
 *   piece that imports no capability vertical: that one is a mechanism.
 * - V1b A capability vertical whose folder name is not the name of its
 *   capability. So two verticals of one workspace cannot share a
 *   capability: they become one vertical with sub-verticals. Also a
 *   mechanism whose folder has the name of a capability.
 * - V2 A mechanism that imports a capability vertical of its workspace.
 * - V5 A capability vertical that imports more than 5 other capability
 *   verticals of its workspace. A mechanism does not count.
 *
 * V2 and V5 do not apply to the wiring piece: to compose the capabilities
 * is its work. In return no vertical imports it. This check does not test
 * that, because rule (h) of `scripts/check-verticals.ts` already does: in an
 * app, only the routes, the entry folders and the entry files import
 * `shared/shell`. That is why the wiring piece must be that folder.
 *
 * An import is any import the reader finds: `import type`, `export from`,
 * `import()` and `require()` count. An import through a peer port or of a
 * leaf contract counts too. A test does not count.
 *
 * `scripts/capability-debt.txt` lists what breaks V1b, V2 and V5 today,
 * one line each:
 *
 *   rename <workspace> <vertical>          V1b: the folder has another name
 *   imports <workspace> <from> <to>        V2: the mechanism imports the capability
 *   wide <workspace> <vertical> <count>    V5: it imports that many
 *
 * A new offender fails. A line fails once it is not needed any more, so
 * the list can only get shorter. A `wide` line fails when the count goes
 * up, and when the vertical is at 5 or less. Remove the line in the change
 * that fixes the code.
 *
 *   bun scripts/check-capabilities.ts
 *
 * Exits 1 and names each problem. Fix the code. Do not add a line.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import {
	CAPABILITIES,
	INSIGHTS_CAPABILITIES,
	MECHANISM,
	VERTICALS,
	WIRING,
} from "./capabilities";
import { isTest } from "./check-layers";
import {
	parse,
	resolverFor,
	type Vertical,
	verticalsOf,
	walk,
	workspacesOf,
} from "./check-verticals";

/** V5: the most other capability verticals a capability vertical imports. */
export const MAX_CAPABILITY_IMPORTS = 5;

/**
 * The one folder that may be a wiring piece: the shared piece of an app
 * that rule (h) of `check-verticals.ts` closes to every vertical (`SHELL`
 * in `scripts/verticals/workspace.ts`).
 */
const WIRING_PIECE = "shared/shell";

const MAP_FILE = "scripts/capabilities.ts";
const DEBT_FILE = "scripts/capability-debt.txt";

/** What the check reads of the map. The tests give it a small one. */
export type CapabilityMap = {
	/** The names of the capabilities. */
	capabilities: string[];
	/** workspace → vertical → the name of its capability, MECHANISM or WIRING. */
	verticals: Record<string, Record<string, string>>;
};

/** The folder name of a vertical: `runs` of `features/runs`. */
const folderOf = (vertical: string): string =>
	vertical.split("/").pop() as string;

export type VerticalImports = {
	/** The verticals on disk, as `check-verticals.ts` names them, sorted. */
	verticals: Vertical[];
	/** from → to → the first production file of `from` that imports `to`. */
	imports: Map<string, Map<string, string>>;
};

/**
 * The verticals of one workspace and the imports between them. A test
 * does not count. Every other import does, a type-only one too.
 */
export function verticalImports(
	root: string,
	workspace: string,
): VerticalImports {
	const wsDir = resolve(root, workspace);
	const app = workspace.startsWith("apps/");
	const verticals = verticalsOf(join(wsDir, "src"), app).sort((a, b) =>
		a.name < b.name ? -1 : 1,
	);
	const verticalOf = (path: string) =>
		verticals.find((v) => path.startsWith(`${v.dir}${sep}`));
	const resolveImport = resolverFor(wsDir);
	const paths: string[] = [];
	walk(wsDir, paths, true);
	const imports: VerticalImports["imports"] = new Map();
	for (const path of paths) {
		if (isTest(relative(wsDir, path))) continue;
		const from = verticalOf(path);
		if (!from) continue;
		for (const { specifier } of parse(path).imports) {
			const target = resolveImport(path, specifier);
			const to = target ? verticalOf(target) : undefined;
			if (!to || to === from) continue;
			const out = imports.get(from.name) ?? new Map<string, string>();
			if (!out.has(to.name)) out.set(to.name, path);
			imports.set(from.name, out);
		}
	}
	return { verticals, imports };
}

export type Rename = { workspace: string; vertical: string };
export type MechanismImport = { workspace: string; from: string; to: string };
export type Wide = { workspace: string; vertical: string; count: number };

/** What breaks V1b, V2 and V5: on disk (`measure`) or listed (`debtOf`). */
export type Debt = {
	rename: Rename[];
	imports: MechanismImport[];
	wide: Wide[];
};

/** The debt list: one entry per line. `#` starts a comment. */
export function debtOf(text: string): Debt & { problems: string[] } {
	const debt: Debt & { problems: string[] } = {
		rename: [],
		imports: [],
		wide: [],
		problems: [],
	};
	const seen = new Set<string>();
	for (const raw of text.split("\n")) {
		const line = raw.replace(/#.*/, "").trim().replace(/\s+/g, " ");
		if (!line) continue;
		const [kind, workspace, a, b, ...rest] = line.split(" ");
		const key = [kind, workspace, a, kind === "imports" ? b : ""].join(" ");
		const count = Number(b);
		if (kind === "rename" && workspace && a && !b) {
			debt.rename.push({ workspace, vertical: a });
		} else if (kind === "imports" && workspace && a && b && !rest.length) {
			debt.imports.push({ workspace, from: a, to: b });
		} else if (
			kind === "wide" &&
			workspace &&
			a &&
			Number.isInteger(count) &&
			count > 0 &&
			!rest.length
		) {
			debt.wide.push({ workspace, vertical: a, count });
		} else {
			debt.problems.push(
				`${DEBT_FILE}: "${line}" is not a debt line. Write "rename <workspace> <vertical>", "imports <workspace> <from> <to>" or "wide <workspace> <vertical> <count>".`,
			);
			continue;
		}
		if (seen.has(key)) {
			debt.problems.push(
				`${DEBT_FILE}: "${line}" is listed twice. Remove one line.`,
			);
		}
		seen.add(key);
	}
	return debt;
}

type Measured = Debt & {
	problems: string[];
	/** One file that makes each V2 import, by `workspace from to`. */
	files: Map<string, string>;
	/** The capability verticals each capability vertical imports. */
	widths: Map<string, string[]>;
	counts: {
		verticals: number;
		capabilities: number;
		mechanisms: number;
		wiring: number;
	};
};

/**
 * Reads the workspaces of `root` against the map: the V1a problems, and
 * everything that breaks V1b, V2 and V5, before the debt list.
 */
export function measure(root: string, map: CapabilityMap): Measured {
	const capabilities = new Set(map.capabilities);
	const found: Measured = {
		rename: [],
		imports: [],
		wide: [],
		problems: [],
		files: new Map(),
		widths: new Map(),
		counts: { verticals: 0, capabilities: 0, mechanisms: 0, wiring: 0 },
	};
	const rel = (path: string) => relative(root, path).split(sep).join("/");
	const workspaces = workspacesOf(root);
	const used = new Set<string>();

	for (const workspace of Object.keys(map.verticals).sort()) {
		if (!workspaces.includes(workspace)) {
			found.problems.push(
				`${MAP_FILE}: "${workspace}" is not a checked workspace (V1a). Remove it from VERTICALS.`,
			);
		}
	}

	for (const workspace of workspaces) {
		const app = workspace.startsWith("apps/");
		const listed = map.verticals[workspace] ?? {};
		const { verticals, imports } = verticalImports(root, workspace);
		const onDisk = new Set(verticals.map((v) => v.name));

		// V1a: the map and the disk name the same verticals.
		for (const vertical of verticals) {
			if (!(vertical.name in listed)) {
				found.problems.push(
					`${rel(vertical.dir)}/: the vertical "${vertical.name}" is not on the capability map (V1a). Add it to "${workspace}" in VERTICALS of ${MAP_FILE}, with its capability or MECHANISM.`,
				);
			}
		}
		for (const name of Object.keys(listed).sort()) {
			if (!onDisk.has(name)) {
				found.problems.push(
					`${MAP_FILE}: ${workspace} has no vertical "${name}" (V1a). Remove it from VERTICALS, or write the name it has now.`,
				);
			}
		}

		/** The capability of a vertical that is on disk and on the map. */
		const capabilityOf = (name: string): string | undefined => {
			const place = listed[name];
			return onDisk.has(name) && place && capabilities.has(place)
				? place
				: undefined;
		};
		const isMechanism = (name: string) =>
			onDisk.has(name) && listed[name] === MECHANISM;

		for (const { name, dir } of verticals) {
			const place = listed[name];
			if (place === undefined) continue;
			found.counts.verticals += 1;
			const folder = folderOf(name);
			if (place === MECHANISM) {
				found.counts.mechanisms += 1;
				// V1b: a mechanism does not take the name of a capability.
				// A shared piece of an app is a mechanism by its place.
				if (!name.startsWith("shared/") && capabilities.has(folder)) {
					found.problems.push(
						`${rel(dir)}/: the mechanism "${name}" has the name of the capability "${folder}" (V1b). Give it that capability in ${MAP_FILE}, or name the folder for the machinery it holds.`,
					);
				}
				continue;
			}
			if (place === WIRING) {
				found.counts.wiring += 1;
				// V1a: the wiring is the one folder that rule (h) of the vertical
				// check closes to the verticals, and it composes capabilities.
				if (!app || name !== WIRING_PIECE) {
					found.problems.push(
						`${MAP_FILE}: "${name}" of ${workspace} has WIRING, and the wiring of a workspace is the ${WIRING_PIECE} of an app (V1a). Write MECHANISM. An app composes its features in ${WIRING_PIECE}, and a package in a wire.ts outside the verticals.`,
					);
				} else if (![...(imports.get(name)?.keys() ?? [])].some(capabilityOf)) {
					found.problems.push(
						`${rel(dir)}/: the wiring piece "${name}" imports no capability vertical (V1a). A piece that composes nothing is a mechanism: write MECHANISM in ${MAP_FILE}.`,
					);
				}
				continue;
			}
			if (!capabilities.has(place)) {
				found.problems.push(
					`${MAP_FILE}: "${name}" of ${workspace} has "${place}", which is no capability (V1a). Use a name of CAPABILITIES, MECHANISM or WIRING.`,
				);
				continue;
			}
			found.counts.capabilities += 1;
			used.add(place);
			if (name.startsWith("shared/")) {
				found.problems.push(
					`${MAP_FILE}: "${name}" of ${workspace} is a shared piece, and a shared piece is a mechanism (V1a). Write MECHANISM, or move the folder to features/${place}/.`,
				);
			}
			// V1b: the folder has the name of its capability.
			if (folder !== place) found.rename.push({ workspace, vertical: name });
		}

		for (const { name: from } of verticals) {
			const out = imports.get(from) ?? new Map<string, string>();
			const targets = [...out.keys()].sort();
			// V2: a mechanism imports no capability. The wiring piece may.
			if (isMechanism(from)) {
				for (const to of targets) {
					if (!capabilityOf(to)) continue;
					found.imports.push({ workspace, from, to });
					found.files.set(
						`${workspace} ${from} ${to}`,
						rel(out.get(to) as string),
					);
				}
			}
			// V5: a capability imports few other capability verticals.
			if (capabilityOf(from)) {
				const others = targets.filter((to) => capabilityOf(to));
				found.widths.set(`${workspace} ${from}`, others);
				if (others.length > MAX_CAPABILITY_IMPORTS)
					found.wide.push({ workspace, vertical: from, count: others.length });
			}
		}
	}

	for (const capability of [...capabilities].sort()) {
		if (!used.has(capability)) {
			found.problems.push(
				`${MAP_FILE}: no vertical has the capability "${capability}" (V1a). Remove it from its table, or give it to the vertical that holds it.`,
			);
		}
	}
	return found;
}

/**
 * The problems of `root` against the map and the text of the debt list. A
 * new offender is a problem, and so is a line that is not needed any more.
 */
export function checkCapabilities(
	root: string,
	map: CapabilityMap,
	debtText = "",
): string[] {
	const found = measure(root, map);
	const debt = debtOf(debtText);
	const problems = [...found.problems, ...debt.problems];
	const src = (workspace: string, vertical: string) =>
		`${workspace}/src/${vertical}/`;

	// V1b: the folder has the name of its capability.
	const renameKey = (r: Rename) => `${r.workspace} ${r.vertical}`;
	const listedRenames = new Set(debt.rename.map(renameKey));
	const foundRenames = new Set(found.rename.map(renameKey));
	for (const r of found.rename) {
		if (listedRenames.has(renameKey(r))) continue;
		const capability = map.verticals[r.workspace]?.[r.vertical] as string;
		const home = r.vertical.replace(/[^/]+$/, capability);
		problems.push(
			`${src(r.workspace, r.vertical)}: the vertical is part of the capability "${capability}", but its folder is "${folderOf(r.vertical)}" (V1b). Name the folder "${capability}", or move it into ${src(r.workspace, home)} as a sub-vertical.`,
		);
	}
	for (const r of debt.rename) {
		if (foundRenames.has(renameKey(r))) continue;
		problems.push(
			`${DEBT_FILE}: "rename ${renameKey(r)}" is not needed any more (V1b). Remove the line.`,
		);
	}

	// V2: a mechanism imports no capability.
	const importKey = (i: MechanismImport) => `${i.workspace} ${i.from} ${i.to}`;
	const listedImports = new Set(debt.imports.map(importKey));
	const foundImports = new Set(found.imports.map(importKey));
	for (const i of found.imports) {
		if (listedImports.has(importKey(i))) continue;
		problems.push(
			`${found.files.get(importKey(i))}: the mechanism "${i.from}" imports the capability vertical "${i.to}" (V2). A mechanism imports no capability: let its caller pass in what it needs, or move the rule into the capability.`,
		);
	}
	for (const i of debt.imports) {
		if (foundImports.has(importKey(i))) continue;
		problems.push(
			`${DEBT_FILE}: "imports ${importKey(i)}" is not needed any more (V2): the mechanism "${i.from}" does not import the capability vertical "${i.to}". Remove the line.`,
		);
	}

	// V5: a capability imports at most 5 other capability verticals.
	const allowed = new Map(
		debt.wide.map((w) => [`${w.workspace} ${w.vertical}`, w.count]),
	);
	for (const w of found.wide) {
		const key = `${w.workspace} ${w.vertical}`;
		const limit = allowed.get(key);
		if (limit !== undefined && w.count <= limit) continue;
		const others = (found.widths.get(key) ?? []).join(", ");
		problems.push(
			limit === undefined
				? `${src(w.workspace, w.vertical)}: the capability vertical "${w.vertical}" imports ${w.count} other capability verticals (${others}), and the limit is ${MAX_CAPABILITY_IMPORTS} (V5). Let its caller pass in what it needs, or move the code that wires many into a wire.ts outside the verticals.`
				: `${src(w.workspace, w.vertical)}: the capability vertical "${w.vertical}" imports ${w.count} other capability verticals (${others}), and its debt line allows ${limit} (V5). The count only goes down: remove an import.`,
		);
	}
	for (const w of debt.wide) {
		const key = `${w.workspace} ${w.vertical}`;
		if (found.wide.some((f) => `${f.workspace} ${f.vertical}` === key))
			continue;
		const now = found.widths.get(key);
		problems.push(
			`${DEBT_FILE}: "wide ${key} ${w.count}" is not needed any more (V5): ${now ? `"${w.vertical}" imports ${now.length} other capability verticals` : `"${w.vertical}" is no capability vertical of ${w.workspace}`}. Remove the line.`,
		);
	}
	return problems;
}

/** The terms of the glossary: the first cell of each table row. */
export function glossaryTerms(text: string): Set<string> {
	const terms = new Set<string>();
	for (const line of text.split("\n")) {
		if (!line.startsWith("|")) continue;
		const term = (line.split("|")[1] ?? "").trim();
		if (term && term !== "Term" && !/^-+$/.test(term)) terms.add(term);
	}
	return terms;
}

/**
 * V1a for the tables of the map: a product capability has a word of the
 * glossary, and one name is in one table only.
 */
export function checkTables(
	glossary: string,
	product: Record<string, { word: string }>,
	others: Record<string, unknown> = {},
): string[] {
	const terms = glossaryTerms(glossary);
	const problems: string[] = [];
	for (const [name, { word }] of Object.entries(product)) {
		if (!terms.has(word)) {
			problems.push(
				`${MAP_FILE}: the capability "${name}" has the word "${word}", which is no term of docs/glossary.md (V1a). Use a term of the glossary.`,
			);
		}
		if (name in others) {
			problems.push(
				`${MAP_FILE}: the capability "${name}" is in two tables (V1a). Keep it in one.`,
			);
		}
	}
	return problems;
}

/** The map of this repository, as the check reads it. */
export const REPOSITORY_MAP: CapabilityMap = {
	capabilities: [
		...Object.keys(CAPABILITIES),
		...Object.keys(INSIGHTS_CAPABILITIES),
	],
	verticals: VERTICALS,
};

if (import.meta.main) {
	const started = performance.now();
	const root = join(import.meta.dir, "..");
	const debtFile = join(root, DEBT_FILE);
	const debt = existsSync(debtFile) ? readFileSync(debtFile, "utf8") : "";
	const glossary = readFileSync(join(root, "docs/glossary.md"), "utf8");
	const problems = [
		...checkTables(glossary, CAPABILITIES, INSIGHTS_CAPABILITIES),
		...checkCapabilities(root, REPOSITORY_MAP, debt),
	];
	if (problems.length) {
		console.error(`Capability check failed (${MAP_FILE}):\n`);
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	const { counts } = measure(root, REPOSITORY_MAP);
	const listed = debtOf(debt);
	const ms = Math.round(performance.now() - started);
	console.log(
		`Capability check passed: ${counts.verticals} verticals (${counts.capabilities} of a capability, ${counts.mechanisms} mechanisms, ${counts.wiring} wiring). Debt: ${listed.rename.length} rename, ${listed.imports.length} imports, ${listed.wide.length} wide (${ms} ms).`,
	);
}
