/**
 * Checks the budgets of the code: four sizes that may only shrink.
 *
 * - File size (V6): a source file has at most 600 lines. The count is the
 *   count of `wc -l`: the newline characters in the file.
 * - Folder size (V6): a folder holds at most 25 source files directly in it.
 *   The files of its sub-folders do not count.
 * - Barrel width (V4): the `index.ts` barrel of a vertical holds at most 30
 *   names of its own. So does an `index.ts` in a folder below it, at any
 *   depth. A name is a barrel's own when it comes from a file of its folder,
 *   its ring folders (`domain/`, `application/`, `adapters/`) included. A
 *   name that a barrel passes on from the `index.ts` of a sub-vertical (a
 *   folder below it, at any depth, with its own `index.ts`) counts on that
 *   barrel, and not again on the parent. So a wide vertical is a set of
 *   sub-verticals, each a door of at most 30 names. A name from a file
 *   inside a sub-vertical that is not its `index.ts` counts on the parent.
 *   A type and a value both count. A namespace (`export * as x from`) counts
 *   as one name. `export * from` counts every name it passes on. A package's
 *   root `index.ts` and the entries that its `exports` names are not in
 *   scope: they compose verticals.
 * - Peer ports (V8): `PEER_PORTS` of `scripts/check-verticals.ts` gets no
 *   new pair of verticals.
 *
 * A source file is a `.ts` or `.tsx` file in the `src/` or the `scripts/`
 * folder of a workspace, or in the `scripts/` folder of the repository. A
 * test (`*.test.ts`, `*.test.tsx`), a declaration file (`*.d.ts`) and a
 * generated file (GENERATED below) do not count. A fake or a fixture is not
 * a test here: it counts. The test code of a slice's driven adapters does
 * not count (`adapters/out/in-memory-*.ts`, `adapters/out/*.contract.ts`:
 * `isAdapterTestCode` of `scripts/check-layers.ts`).
 *
 * It checks the workspaces that `scripts/check-verticals.ts` checks (not
 * `ui`, `ui-native` and `config`), and it finds the verticals the same way.
 *
 * Each rule is a ratchet with a debt list beside this script:
 * `size-debt.txt`, `folder-debt.txt`, `barrel-debt.txt` (a path and its
 * number on the day it was listed) and `peer-port-debt.txt` (a workspace and
 * the two verticals). The check fails on:
 * - an offender that is not on the list
 * - a listed entry whose number is above the listed number
 * - a listed entry that is within the limit, or that is gone: remove its
 *   line, so the list only gets shorter
 * A debt list gets no new line. Fix the offender.
 *
 *   bun scripts/check-budgets.ts                  every workspace, and scripts/
 *   bun scripts/check-budgets.ts packages/engine  only that workspace
 *   bun scripts/check-budgets.ts --tighten        lower the listed numbers to
 *                                                 today's, drop the clean lines
 *
 * Exits 1 and names each problem.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { isAdapterTestCode } from "./check-layers";
import {
	entryFiles,
	PEER_PORTS,
	parse,
	resolveFile,
	resolverFor,
	verticalsOf,
	workspacesOf,
} from "./check-verticals";

/**
 * The generated files. A tool writes them, so their size is not ours to
 * split. One entry per file, with the tool that writes it. No pattern: a
 * new generated file gets its own entry.
 */
export const GENERATED: { file: string; why: string }[] = [
	{
		file: "apps/web/src/routeTree.gen.ts",
		why: "TanStack Router writes the route tree at build time. Git ignores it.",
	},
	{
		file: "apps/insights/src/routeTree.gen.ts",
		why: "TanStack Router writes the route tree at build time. Git ignores it.",
	},
	{
		file: "apps/web/src/env.ts",
		why: "`varlock codegen` writes the typed env at install. Git ignores it.",
	},
	{
		file: "apps/server/src/env.ts",
		why: "`varlock codegen` writes the typed env at install. Git ignores it.",
	},
	{
		file: "apps/mobile/src/env.ts",
		why: "`varlock codegen` writes the typed env at install. Git ignores it.",
	},
	{
		file: "packages/db/src/env.ts",
		why: "`varlock codegen` writes the typed env at install. Git ignores it.",
	},
	{
		file: "packages/semconv/src/registry/generated.ts",
		why: "`bun scripts/generate-semconv.ts` writes it from the Weaver registry.",
	},
	{
		file: "packages/db/src/schema/auth.ts",
		why: "`bun run auth:generate` writes the Better Auth tables.",
	},
];

/** The scripts of the repository: a scope of its own, beside the workspaces. */
export const ROOT_SCRIPTS = "scripts";

/** Folders that hold no source: installs, build output and dot folders. */
const skipped = (name: string) =>
	name === "node_modules" || name === "dist" || name.startsWith(".");

/** A source file by its name: not a test, not a declaration file. */
const isSource = (name: string) =>
	/\.tsx?$/.test(name) &&
	!name.endsWith(".d.ts") &&
	!/\.test\.tsx?$/.test(name);

/** One rule with a number: its limit, its debt list and its words. */
export type Budget = {
	/** The rule, as a message names it. */
	rule: string;
	limit: number;
	/** What the number counts. */
	unit: string;
	/** The debt list, by its path in the repository. */
	list: string;
	/** What a listed path names. */
	kind: string;
	/** What to do with an offender. */
	fix: string;
};

export const FILE_SIZE: Budget = {
	rule: "file size",
	limit: 600,
	unit: "lines",
	list: "scripts/size-debt.txt",
	kind: "a source file",
	fix: "Split the file by sub-domain.",
};

export const FOLDER_SIZE: Budget = {
	rule: "folder size",
	limit: 25,
	unit: "source files",
	list: "scripts/folder-debt.txt",
	kind: "a folder of source files",
	fix: "Move the files of one sub-domain into a sub-folder.",
};

export const BARREL_WIDTH: Budget = {
	rule: "barrel width",
	limit: 30,
	unit: "names of its own",
	list: "scripts/barrel-debt.txt",
	kind: "a barrel in a vertical",
	fix: "Split the vertical into sub-verticals by sub-domain (a name counts on the barrel of its sub-vertical), or take names off the barrel.",
};

/**
 * The ring folders of a slice. An `index.ts` in one, or below one, is no
 * barrel of a sub-vertical: its names are the slice's own.
 */
const RING_FOLDERS = new Set(["domain", "application", "adapters"]);

/** The debt list of the peer ports, by its path in the repository. */
export const PEER_PORT_LIST = "scripts/peer-port-debt.txt";

/**
 * What the check covers: every workspace that the vertical check covers,
 * and the scripts of the repository.
 */
export function scopesOf(root: string): string[] {
	const scopes = workspacesOf(root);
	if (existsSync(join(root, ROOT_SCRIPTS))) scopes.push(ROOT_SCRIPTS);
	return scopes;
}

/** The lines of a file as `wc -l` counts them: its newline characters. */
export function linesOf(bytes: Uint8Array): number {
	let lines = 0;
	for (const byte of bytes) if (byte === 10) lines++;
	return lines;
}

export type Sizes = {
	/** The lines of each source file. */
	files: Map<string, number>;
	/** The source files directly in each folder. */
	folders: Map<string, number>;
	/** The names of its own on each barrel in a vertical. */
	barrels: Map<string, number>;
};

/**
 * The sizes of `scopes` in `root`, by path from the root with `/`.
 * `generated` are the files that do not count.
 */
export function measure(
	root: string,
	scopes: string[],
	generated: string[] = GENERATED.map((entry) => entry.file),
): Sizes {
	const rel = (path: string) => relative(root, path).split(sep).join("/");
	const sizes: Sizes = {
		files: new Map(),
		folders: new Map(),
		barrels: new Map(),
	};
	const walk = (dir: string): void => {
		if (!existsSync(dir)) return;
		let count = 0;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!skipped(entry.name)) walk(path);
			} else if (
				isSource(entry.name) &&
				!isAdapterTestCode(path) &&
				!generated.includes(rel(path))
			) {
				sizes.files.set(rel(path), linesOf(readFileSync(path)));
				count++;
			}
		}
		sizes.folders.set(rel(dir), count);
	};
	for (const scope of scopes) {
		if (scope === ROOT_SCRIPTS) {
			walk(join(root, scope));
			continue;
		}
		const wsDir = resolve(root, scope);
		const src = join(wsDir, "src");
		walk(src);
		walk(join(wsDir, "scripts"));
		if (!existsSync(src)) continue;
		const resolveImport = resolverFor(wsDir);
		const namesOn = (path: string, seen = new Set<string>()): string[] => {
			if (seen.has(path)) return [];
			seen.add(path);
			const { exports } = parse(path);
			const names = [...exports.names];
			for (const star of exports.stars) {
				const target = resolveImport(path, star);
				if (target) names.push(...namesOn(target, seen));
			}
			return names;
		};
		const entries = entryFiles(wsDir);
		/**
		 * `target` is the barrel of a sub-vertical of `dir`: an `index.ts`
		 * in a folder below it. Not one in a ring folder, and not an entry
		 * of the package, which this check does not measure.
		 */
		const subBarrel = (dir: string, target: string | undefined) =>
			target !== undefined &&
			/^index\.tsx?$/.test(basename(target)) &&
			dirname(target).startsWith(`${dir}${sep}`) &&
			!entries.has(target) &&
			!relative(dir, dirname(target))
				.split(sep)
				.some((folder) => RING_FOLDERS.has(folder));
		/** The names of its own on a barrel: not the ones it passes on. */
		const ownNames = (barrel: string): Set<string> => {
			const dir = dirname(barrel);
			const file = parse(barrel);
			const passedOn = (specifier: string | undefined) =>
				specifier !== undefined &&
				subBarrel(dir, resolveImport(barrel, specifier));
			const passed = new Set<string>();
			for (const { specifier, exported } of file.reexports)
				if (passedOn(specifier)) passed.add(exported);
			for (const { local, exported } of file.localExports)
				if (passedOn(file.bindings.get(local)?.specifier)) passed.add(exported);
			const names = new Set(
				file.exports.names.filter((name) => !passed.has(name)),
			);
			for (const star of file.exports.stars) {
				const target = resolveImport(barrel, star);
				if (!target || subBarrel(dir, target)) continue;
				for (const name of namesOn(target, new Set([barrel]))) names.add(name);
			}
			return names;
		};
		// The barrel of a vertical, and each index.ts in a folder below it.
		const barrelsIn = (dir: string): void => {
			const barrel = resolveFile(join(dir, "index"));
			if (barrel && !entries.has(barrel))
				sizes.barrels.set(rel(barrel), ownNames(barrel).size);
			for (const entry of readdirSync(dir, { withFileTypes: true }))
				if (entry.isDirectory() && !skipped(entry.name))
					barrelsIn(join(dir, entry.name));
		};
		for (const vertical of verticalsOf(src, scope.startsWith("apps/")))
			barrelsIn(vertical.dir);
	}
	return sizes;
}

/** A line of a debt list that holds an entry: not blank, not a comment. */
const entryOf = (line: string) => line.replace(/#.*/, "").trim();

/**
 * A debt list: `path number` per line. `#` starts a comment. A line that is
 * not an entry, and a path that is listed twice, are problems.
 */
export function debtOf(
	text: string,
	list: string,
): { entries: Map<string, number>; problems: string[] } {
	const entries = new Map<string, number>();
	const problems: string[] = [];
	text.split("\n").forEach((line, index) => {
		const entry = entryOf(line);
		if (!entry) return;
		const match = /^(\S+)\s+(\d+)$/.exec(entry);
		if (!match) {
			problems.push(
				`${list}:${index + 1}: "${entry}" is not an entry. Write a path and a number.`,
			);
		} else if (entries.has(match[1] as string)) {
			problems.push(
				`${list}:${index + 1}: ${match[1]} is listed twice. Remove one line.`,
			);
		} else entries.set(match[1] as string, Number(match[2]));
	});
	return { entries, problems };
}

/**
 * The problems of one budget. `sizes` are today's numbers, `debt` is the
 * text of the debt list, and `mine` says which listed paths this run
 * measured (a run for one workspace does not judge the lines of another).
 */
export function overBudget(
	budget: Budget,
	sizes: Map<string, number>,
	debt: string,
	mine: (path: string) => boolean = () => true,
): string[] {
	const { rule, limit, unit, list, kind, fix } = budget;
	const { entries, problems } = debtOf(debt, list);
	const paths = [...sizes.keys()].sort();
	for (const path of paths) {
		const size = sizes.get(path) as number;
		if (size <= limit) continue;
		const listed = entries.get(path);
		if (listed === undefined) {
			problems.push(
				`${path}: ${size} ${unit}, and the limit is ${limit} (${rule}). ${fix}`,
			);
		} else if (size > listed) {
			problems.push(
				`${path}: ${size} ${unit}, and ${list} allows ${listed} (${rule}, the limit is ${limit}). A listed entry only shrinks. ${fix}`,
			);
		}
	}
	for (const path of entries.keys()) {
		if (!mine(path)) continue;
		const size = sizes.get(path);
		if (size === undefined) {
			problems.push(
				`${list}: ${path} is not ${kind} (${rule}). Remove its line.`,
			);
		} else if (size <= limit) {
			problems.push(
				`${list}: ${path} has ${size} ${unit}, within the limit of ${limit} (${rule}). Remove its line.`,
			);
		}
	}
	return problems;
}

/**
 * A debt list with each number lowered to today's size, and without the
 * lines that are within the limit or gone. It adds no line and raises no
 * number. Comments stay.
 */
export function tightened(
	budget: Budget,
	sizes: Map<string, number>,
	debt: string,
): string {
	const kept: string[] = [];
	for (const line of debt.split("\n")) {
		const match = /^(\S+)\s+(\d+)$/.exec(entryOf(line));
		if (!match) {
			kept.push(line);
			continue;
		}
		const size = sizes.get(match[1] as string);
		if (size === undefined || size <= budget.limit) continue;
		kept.push(`${match[1]} ${Math.min(size, Number(match[2]))}`);
	}
	return kept.join("\n");
}

/** Each peer port as `workspace from to`, sorted. */
export function peerPortPairs(ports: typeof PEER_PORTS = PEER_PORTS): string[] {
	const pairs: string[] = [];
	for (const [workspace, verticals] of Object.entries(ports))
		for (const [from, targets] of Object.entries(verticals))
			for (const to of Object.keys(targets))
				pairs.push(`${workspace} ${from} ${to}`);
	return pairs.sort();
}

/**
 * The problems of the peer ports. `pairs` are today's (`peerPortPairs`),
 * `debt` is the text of the frozen list: `workspace from to` per line.
 * A pair that is not on the list is new. A listed pair that is gone is a
 * line to remove. `mine` says which workspaces this run checks.
 */
export function newPeerPorts(
	pairs: string[],
	debt: string,
	mine: (workspace: string) => boolean = () => true,
): string[] {
	const problems: string[] = [];
	const frozen: string[] = [];
	debt.split("\n").forEach((line, index) => {
		const words = entryOf(line).split(/\s+/).filter(Boolean);
		if (!words.length) return;
		if (words.length === 3) frozen.push(words.join(" "));
		else
			problems.push(
				`${PEER_PORT_LIST}:${index + 1}: "${entryOf(line)}" is not an entry. Write a workspace and two verticals.`,
			);
	});
	const workspaceOf = (pair: string) => pair.split(" ")[0] as string;
	for (const pair of pairs) {
		if (frozen.includes(pair) || !mine(workspaceOf(pair))) continue;
		const [workspace, from, to] = pair.split(" ");
		problems.push(
			`scripts/check-verticals.ts: the peer port from ${from} to ${to} in ${workspace} is new: ${pairs.length} peer ports, and ${PEER_PORT_LIST} allows the ${frozen.length} it lists (peer ports). Add no peer port. Move what both verticals need into the lower one, or let an entry file pass it in.`,
		);
	}
	for (const pair of frozen) {
		if (pairs.includes(pair) || !mine(workspaceOf(pair))) continue;
		problems.push(
			`${PEER_PORT_LIST}: ${pair} is not in PEER_PORTS any more (peer ports). Remove its line.`,
		);
	}
	return problems;
}

/** The text of each debt list. */
export type Lists = {
	size: string;
	folder: string;
	barrel: string;
	peerPorts: string;
};

/**
 * The budget problems of `scopes` (workspaces, or `scripts`), as messages.
 * `root` is the repository root. A name that is not a scope is a problem.
 */
export function checkBudgets(
	root: string,
	scopes: string[],
	lists: Lists,
	options: { generated?: string[]; peerPorts?: typeof PEER_PORTS } = {},
): string[] {
	const all = scopesOf(root);
	const problems: string[] = [];
	const checked = scopes.filter((scope) => {
		if (all.includes(scope)) return true;
		problems.push(`${scope}: is not a workspace.`);
		return false;
	});
	const under = (scope: string, path: string) =>
		path === scope || path.startsWith(`${scope}/`);
	// A listed path of no scope at all is a line to remove, in every run.
	const mine = (path: string) =>
		checked.some((scope) => under(scope, path)) ||
		!all.some((scope) => under(scope, path));
	const sizes = measure(root, checked, options.generated);
	problems.push(
		...overBudget(FILE_SIZE, sizes.files, lists.size, mine),
		...overBudget(FOLDER_SIZE, sizes.folders, lists.folder, mine),
		...overBudget(BARREL_WIDTH, sizes.barrels, lists.barrel, mine),
		...newPeerPorts(
			peerPortPairs(options.peerPorts),
			lists.peerPorts,
			(workspace) => checked.includes(workspace) || !all.includes(workspace),
		),
	);
	return problems;
}

if (import.meta.main) {
	const started = performance.now();
	const root = join(import.meta.dir, "..");
	const args = process.argv.slice(2);
	const named = args.filter((arg) => arg !== "--tighten");
	const scopes = named.length ? named : scopesOf(root);
	const read = (list: string) => readFileSync(join(root, list), "utf8");
	if (args.includes("--tighten")) {
		const sizes = measure(root, scopesOf(root));
		for (const [budget, measured] of [
			[FILE_SIZE, sizes.files],
			[FOLDER_SIZE, sizes.folders],
			[BARREL_WIDTH, sizes.barrels],
		] as const) {
			const before = read(budget.list);
			const after = tightened(budget, measured, before);
			if (after !== before) {
				writeFileSync(join(root, budget.list), after);
				console.log(`Tightened ${budget.list}.`);
			}
		}
	}
	const problems = checkBudgets(root, scopes, {
		size: read(FILE_SIZE.list),
		folder: read(FOLDER_SIZE.list),
		barrel: read(BARREL_WIDTH.list),
		peerPorts: read(PEER_PORT_LIST),
	});
	if (problems.length) {
		console.error(
			"Budget check failed (file size, folder size, barrel width, peer ports):\n",
		);
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	const ms = Math.round(performance.now() - started);
	console.log(`Budget check passed: ${scopes.join(", ")} (${ms} ms).`);
}
