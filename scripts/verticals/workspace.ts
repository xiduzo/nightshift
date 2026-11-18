/**
 * The rules of one workspace: (a) to (l) and (n) to (p) of
 * `scripts/check-verticals.ts`. That file holds the header with every
 * rule, and the listed exceptions.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { isTest } from "../check-layers";
import { cyclicGroups, shortestCycle } from "./cycles";
import { KIND_FOLDER_DEBT, NESTING_DEBT, ratchet } from "./debt";
import {
	CATCH_ALL_FILES,
	CATCH_ALL_FOLDERS,
	KIND_BUCKETS,
	kindFolderFindings,
} from "./folder-names";
import { nestingFindings } from "./nesting";
import {
	aliases,
	entryFiles,
	packageJson,
	resolveFile,
	resolverFor,
} from "./resolve";
import { parse, type SourceFile, walk } from "./source-file";
import { type Vertical, verticalsOf } from "./vertical";

/** The app's shared piece that composes the features. */
const SHELL = "shared/shell";

export type Options = {
	leafContracts?: Record<string, string[]>;
	peerPorts?: Record<string, Record<string, string>>;
	/** An app's entry folders at the top of `src/` (ENTRY_DIRS). */
	entryDirs?: string[];
	/** The verticals whose imports the cycle check skips (KNOWN_CYCLES). */
	knownCycles?: string[];
	/** The lines of `scripts/kind-folder-debt.txt` for this workspace (n). */
	kindFolderDebt?: string[];
	/** The lines of `scripts/nesting-debt.txt` for this workspace (o, p). */
	nestingDebt?: string[];
};

/**
 * The problems of one workspace (`apps/web`, `packages/engine`), as
 * messages. `root` is the repository root.
 */
export function checkWorkspace(
	root: string,
	workspace: string,
	options: Options = {},
): string[] {
	const wsDir = resolve(root, workspace);
	const src = join(wsDir, "src");
	const app = workspace.replace(/\\/g, "/").startsWith("apps/");
	const rel = (path: string) => relative(root, path).split(sep).join("/");
	const inside = (dir: string, path: string) =>
		path === dir || path.startsWith(`${dir}${sep}`);
	const problems: string[] = [];

	if (!existsSync(src)) return [`${workspace}: has no src/ folder.`];

	// (c) and (g) Top-level layout.
	const entryDirs = new Set(options.entryDirs ?? []);
	const appTop = [
		"features/",
		"shared/",
		...[...entryDirs].map((d) => `${d}/`),
	];
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (KIND_BUCKETS.has(entry.name)) {
			problems.push(
				`${rel(join(src, entry.name))}/: "${entry.name}" is a kind bucket. Move each file into the vertical that uses it (${app ? "src/features/<vertical>/ or a named src/shared/<name>/" : "src/<vertical>/"}).`,
			);
		} else if (
			app &&
			entry.name !== "features" &&
			entry.name !== "shared" &&
			!entryDirs.has(entry.name)
		) {
			problems.push(
				`${rel(join(src, entry.name))}/: the top of an app's src/ holds only ${appTop.join(", ")} and entry files. Move it into src/features/<vertical>/ or a named src/shared/<name>/.`,
			);
		}
	}
	if (app) {
		const shared = join(src, "shared");
		if (existsSync(shared)) {
			for (const entry of readdirSync(shared, { withFileTypes: true })) {
				if (entry.isFile()) {
					problems.push(
						`${rel(join(shared, entry.name))}: a loose file in shared/. Put it in a named folder with a barrel (shared/<name>/index.ts).`,
					);
				}
			}
		}
	}

	const verticals = verticalsOf(src, app);
	for (const vertical of verticals) {
		if (!vertical.barrel) {
			problems.push(
				`${rel(vertical.dir)}/: the vertical "${vertical.name}" has no index.ts. Add a barrel that exports what other code uses.`,
			);
		}
	}
	const verticalOf = (path: string) =>
		verticals.find((v) => path.startsWith(`${v.dir}${sep}`));

	// Every file of the workspace: the files outside src/ (config files,
	// scripts, tests) belong to no vertical, but they import verticals.
	const files = new Map<string, SourceFile>();
	const paths: string[] = [];
	walk(wsDir, paths, true);
	for (const path of paths) {
		const file = parse(path);
		file.test = isTest(relative(wsDir, path));
		files.set(path, file);
	}

	const pathAliases = aliases(wsDir);
	const resolveImport = resolverFor(wsDir);

	const leafContracts = options.leafContracts ?? {};
	const peerPorts = options.peerPorts ?? {};
	/** The leaf contracts and peer ports that an import uses. */
	const usedExemptions = new Set<string>();
	const exempt = (
		from: Vertical | undefined,
		to: Vertical,
		target: string,
	): boolean => {
		const inside = relative(to.dir, target)
			.split(sep)
			.join("/")
			.replace(/\.tsx?$/, "");
		if ((leafContracts[to.name] ?? []).includes(inside)) {
			usedExemptions.add(`leaf ${to.name}/${inside}`);
			return true;
		}
		if (from && peerPorts[from.name]?.[to.name] === inside) {
			usedExemptions.add(`port ${from.name} ${to.name}`);
			return true;
		}
		return false;
	};
	const barrelSpecifier = (from: string, to: Vertical) => {
		const atAlias = pathAliases.find((a) => a.target === src);
		if (atAlias) return `${atAlias.prefix}${to.name}`;
		const path = relative(dirname(from), to.dir).split(sep).join("/");
		return path.startsWith(".") ? path : `./${path}`;
	};

	// (k) Catch-all names, at any depth. A kind bucket at the top of src/
	// has its own message (c).
	const catchAllFolders = new Set<string>();
	for (const path of files.keys()) {
		const base = (path.split(sep).pop() ?? "").replace(/(\.test)?\.tsx?$/, "");
		if (CATCH_ALL_FILES.has(base)) {
			problems.push(
				`${rel(path)}: "${base}" is a catch-all name. Name the file for what it holds, or move each part into the file that uses it.`,
			);
		}
		let dir = dirname(path);
		while (inside(wsDir, dir) && dir !== wsDir) {
			const name = dir.split(sep).pop() ?? "";
			if (
				CATCH_ALL_FOLDERS.has(name) &&
				!(dirname(dir) === src && KIND_BUCKETS.has(name))
			)
				catchAllFolders.add(dir);
			dir = dirname(dir);
		}
	}
	for (const dir of [...catchAllFolders].sort()) {
		problems.push(
			`${rel(dir)}/: "${dir.split(sep).pop()}" is a catch-all folder. Name it for what it holds, or move each file into the folder that uses it.`,
		);
	}

	// (d), (e) and (f): imports that leave the workspace, name it, or reach
	// a test from production code.
	const ownName = packageJson(wsDir).name;
	for (const file of files.values()) {
		for (const { specifier } of file.imports) {
			if (
				specifier.startsWith(".") &&
				!inside(wsDir, resolve(dirname(file.path), specifier))
			) {
				problems.push(
					`${rel(file.path)}: imports "${specifier}", a path outside ${workspace}. Import the package by its name and an entry that its package.json exports.`,
				);
				continue;
			}
			if (
				ownName &&
				(specifier === ownName || specifier.startsWith(`${ownName}/`))
			) {
				problems.push(
					`${rel(file.path)}: imports its own package by name ("${specifier}"). Import the file or the vertical's barrel by a relative path.`,
				);
				continue;
			}
			if (file.test) continue;
			const target = resolveImport(file.path, specifier);
			if (target && files.get(target)?.test) {
				problems.push(
					`${rel(file.path)}: imports "${specifier}", which only tests may use (a test, a fake, a fixture or a test helper). Production code never imports it.`,
				);
			}
		}
	}

	// (a) Deep imports, and the uses of each barrel for (b).
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

	/** The imports between verticals for (l), each with one file that makes it. */
	const edges = new Map<string, Map<string, string>>();
	for (const file of files.values()) {
		const from = verticalOf(file.path);
		for (const imported of file.imports) {
			const target = resolveImport(file.path, imported.specifier);
			if (!target) continue;
			const to = verticalOf(target);
			if (!to || to === from) continue;
			if (from && !file.test && !exempt(from, to, target)) {
				const out = edges.get(from.name) ?? new Map<string, string>();
				if (!out.has(to.name)) out.set(to.name, file.path);
				edges.set(from.name, out);
			}
			if (target === to.barrel) {
				if (!file.test || to.name.endsWith("testing"))
					markUsed(target, imported.names);
				continue;
			}
			if (file.test) continue;
			if (exempt(from, to, target)) continue;
			const port = from ? peerPorts[from.name]?.[to.name] : undefined;
			problems.push(
				`${rel(file.path)}: imports "${imported.specifier}" past the barrel of ${to.name}. ${port ? `These verticals cross only through their port: import "${barrelSpecifier(file.path, to)}/${port}".` : `Import "${barrelSpecifier(file.path, to)}" instead.`}`,
			);
		}
	}

	// A leaf contract imports nothing, and is still needed. So is a port.
	for (const [toName, contracts] of Object.entries(leafContracts)) {
		for (const contract of contracts) {
			const to = verticals.find((v) => v.name === toName);
			const path = to ? resolveFile(join(to.dir, contract)) : undefined;
			const file = path ? files.get(path) : undefined;
			if (!path || !file) {
				problems.push(
					`scripts/check-verticals.ts: the leaf contract "${toName}/${contract}" is not a file of ${workspace}. Fix or remove it.`,
				);
			} else if (file.imports.length) {
				problems.push(
					`${rel(path)}: a leaf contract imports nothing, but it imports ${file.imports.map((i) => `"${i.specifier}"`).join(", ")}.`,
				);
			} else if (!usedExemptions.has(`leaf ${toName}/${contract}`)) {
				problems.push(
					`scripts/check-verticals.ts: nothing imports the leaf contract "${toName}/${contract}" past the barrel any more. Remove it from LEAF_CONTRACTS.`,
				);
			}
		}
	}
	for (const [fromName, ports] of Object.entries(peerPorts)) {
		for (const [toName, port] of Object.entries(ports)) {
			const to = verticals.find((v) => v.name === toName);
			if (!to || !resolveFile(join(to.dir, port))) continue;
			if (!usedExemptions.has(`port ${fromName} ${toName}`)) {
				problems.push(
					`scripts/check-verticals.ts: ${fromName} does not import the peer port "${toName}/${port}" any more. Remove it from PEER_PORTS.`,
				);
			}
		}
	}

	// (l) No cycle between verticals, `import type` included. A known cycle
	// vertical's own imports do not count, until it is in no cycle.
	const knownCycles = new Set(options.knownCycles ?? []);
	const cyclic = cyclicGroups(edges);
	for (const name of knownCycles) {
		if (!cyclic.some((group) => group.includes(name))) {
			problems.push(
				`scripts/check-verticals.ts: ${name} is in no cycle any more. Remove it from KNOWN_CYCLES, and its entry from STRUCTURE.md section 8.`,
			);
		}
	}
	const counted = new Map(
		[...edges].filter(([from]) => !knownCycles.has(from)),
	);
	for (const group of cyclicGroups(counted)) {
		const path = shortestCycle(counted, group);
		const steps = path
			.slice(1)
			.map(
				(to, i) =>
					`${to} (${rel(counted.get(path[i] as string)?.get(to) as string)})`,
			);
		problems.push(
			`${workspace}: the verticals ${group.join(", ")} import each other: ${[path[0], ...steps].join(" -> ")}. Move what both need into the lower vertical, or cross through a peer port.`,
		);
	}

	// (h) The order of an app's shared pieces: they import no feature, and
	// only the routes and the entry files import the shell. Tests too.
	if (app) {
		for (const file of files.values()) {
			const from = verticalOf(file.path);
			if (!from) continue;
			for (const { specifier } of file.imports) {
				const target = resolveImport(file.path, specifier);
				const to = target ? verticalOf(target) : undefined;
				if (!to || to === from) continue;
				if (to.name === SHELL) {
					problems.push(
						`${rel(file.path)}: imports ${SHELL}, which composes the features. Only the routes and the app's entry files import it.`,
					);
				} else if (
					from.name.startsWith("shared/") &&
					from.name !== SHELL &&
					to.name.startsWith("features/")
				) {
					problems.push(
						`${rel(file.path)}: the shared piece ${from.name} imports the feature ${to.name}. A shared piece imports no feature: let an entry file pass the feature's rule in (STRUCTURE.md section 5).`,
					);
				}
			}
		}
	}

	// (i) A peer port, and each file of its vertical that it reaches, import
	// no other vertical than a shared piece: so the port closes no cycle.
	for (const [fromName, ports] of Object.entries(peerPorts)) {
		for (const [toName, port] of Object.entries(ports)) {
			const to = verticals.find((v) => v.name === toName);
			const start = to ? resolveFile(join(to.dir, port)) : undefined;
			if (!to || !start) {
				problems.push(
					`scripts/check-verticals.ts: the peer port "${toName}/${port}" of ${fromName} is not a file of ${workspace}. Fix or remove it.`,
				);
				continue;
			}
			const seen = new Set<string>();
			const queue = [start];
			while (queue.length) {
				const path = queue.pop() as string;
				if (seen.has(path)) continue;
				seen.add(path);
				const file = files.get(path);
				if (!file) continue;
				for (const { specifier } of file.imports) {
					const target = resolveImport(path, specifier);
					if (!target) continue;
					const other = verticalOf(target);
					if (other === to) queue.push(target);
					else if (other && !other.name.startsWith("shared/")) {
						problems.push(
							`${rel(path)}: imports ${other.name}, but it is (or the peer port "${toName}/${port}" reaches it). A peer port imports no other vertical than a shared piece, so it closes no cycle.`,
						);
					}
				}
			}
		}
	}

	// (j) A barrel, and a package's root index.ts, hold only imports and
	// exports.
	const barrels = verticals.flatMap((v) =>
		v.barrel ? [{ path: v.barrel, home: `a file of ${v.name}` }] : [],
	);
	const rootIndex = app ? undefined : resolveFile(join(src, "index"));
	if (rootIndex) barrels.push({ path: rootIndex, home: "its vertical" });
	for (const { path, home } of barrels) {
		if (files.get(path)?.onlyImportsAndExports === false) {
			problems.push(
				`${rel(path)}: a barrel holds only import and export statements. Move the code into ${home} and export it from there.`,
			);
		}
	}

	// (b) Barrel reachability. A barrel that is a package entry is public.
	const entries = entryFiles(wsDir);
	const exportsOf = (path: string, seen = new Set<string>()): string[] => {
		if (seen.has(path)) return [];
		seen.add(path);
		const file = files.get(path);
		if (!file) return [];
		const names = [...file.exports.names];
		for (const star of file.exports.stars) {
			const target = resolveImport(path, star);
			if (target) names.push(...exportsOf(target, seen));
		}
		return names;
	};
	for (const vertical of verticals) {
		if (!vertical.barrel || entries.has(vertical.barrel)) continue;
		const names = [...new Set(exportsOf(vertical.barrel))].sort();
		const uses = used.get(vertical.barrel);
		if (uses === "all") continue;
		const unused = names.filter((name) => !uses?.has(name));
		if (unused.length) {
			problems.push(
				`${rel(vertical.barrel)}: nothing outside ${vertical.name} imports ${unused.map((n) => `"${n}"`).join(", ")}. Take ${unused.length === 1 ? "it" : "them"} off the barrel.`,
			);
		}
	}

	// (n) No kind folder inside a vertical. (o) and (p) Sub-verticals. Each
	// has a debt list: what is on it passes until it is clean.
	problems.push(
		...ratchet(
			KIND_FOLDER_DEBT,
			options.kindFolderDebt ?? [],
			kindFolderFindings(verticals, rel),
		),
		...ratchet(
			NESTING_DEBT,
			options.nestingDebt ?? [],
			nestingFindings({
				verticals,
				files,
				entries,
				resolveImport,
				exportsOf,
				rel,
			}),
		),
	);

	return problems;
}
