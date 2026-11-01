/**
 * Checks the package rules of docs/steering/STRUCTURE.md (sections 1 and 3).
 *
 * (L1) Every `apps/*` and `packages/*` workspace may depend only on the
 *      workspaces its layer allows. Bun links only declared dependencies,
 *      so the dependencies in each package.json are the real import graph
 *      between workspaces. `@nightshift/config` (shared tsconfig)
 *      `@nightshift/refusal` (the refusal type, which imports nothing)
 *      and `@nightshift/time` (the clock, which imports no Night Shift
 *      package) are allowed everywhere.
 * (L2) Every declared workspace dependency is used: a file of the
 *      workspace imports it (a .ts, .tsx, .js, .mjs, .cjs or .css file), or
 *      its tsconfig extends it.
 * (L3) Every entry in `exports` has an importer in another workspace: a
 *      production file. A test counts only for a `./testing` entry. A
 *      wildcard entry (the shadcn layout) is not checked.
 * (L4) An entry points at the root `src/index.ts`, a file directly in
 *      `src/`, or a barrel one folder down (`src/<vertical>/index.ts`,
 *      `src/testing/index.ts`). A deeper file is a LIGHT_ENTRIES item, with
 *      its reason. `ui` and `ui-native` keep the shadcn layout.
 * (L5) The allow-lists of `noRestrictedImports` in biome.json name exactly
 *      the entries of every package.json.
 *
 *   bun scripts/check-layers.ts
 *
 * Exits 1 and names each violation. Fix the dependency, do not add an
 * exception. If a rule is wrong, change STRUCTURE.md and this script
 * together.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Allowed everywhere: the shared TypeScript config (no code), and the
 * refusal type, which imports nothing, and the clock. Every layer throws
 * a refusal. Every layer may read the clock.
 */
const EVERYWHERE = new Set([
	"@nightshift/config",
	"@nightshift/refusal",
	"@nightshift/time",
]);

export type Rule = {
	layer: number;
	/** The workspaces it may depend on, or "lower": every lower layer. */
	mayImport: string[] | "lower";
};

/**
 * Section 1 of STRUCTURE.md. Apps are not packages: no workspace may depend
 * on an app.
 */
export const LAYERS: Record<string, Rule> = {
	// 0. Foundation
	"@nightshift/config": { layer: 0, mayImport: [] },
	"@nightshift/refusal": { layer: 0, mayImport: [] },
	"@nightshift/time": { layer: 0, mayImport: [] },
	"@nightshift/db": { layer: 0, mayImport: [] },
	"@nightshift/flows": { layer: 0, mayImport: [] },
	"@nightshift/ui": { layer: 0, mayImport: [] },
	"@nightshift/ui-native": { layer: 0, mayImport: [] },
	// 1. Capabilities
	"@nightshift/auth": { layer: 1, mayImport: ["@nightshift/db"] },
	"@nightshift/agents": { layer: 1, mayImport: ["@nightshift/flows"] },
	// 2. Core
	"@nightshift/engine": {
		layer: 2,
		mayImport: [
			"@nightshift/db",
			"@nightshift/flows",
			"@nightshift/agents",
			"@nightshift/auth",
		],
	},
	// 3. Core domains
	"@nightshift/devices": { layer: 3, mayImport: "lower" },
	"@nightshift/notifications": { layer: 3, mayImport: "lower" },
	"@nightshift/telemetry": { layer: 3, mayImport: "lower" },
	// 4. Surface
	"@nightshift/api": { layer: 4, mayImport: "lower" },
	// 5. Runtime
	"@nightshift/daemon": { layer: 5, mayImport: "lower" },
	// Browser- and React-Native-safe client logic for the apps. Biome keeps
	// it to `@nightshift/api/client` (types), the `@nightshift/flows` root,
	// `@nightshift/engine/run-status` and `@nightshift/notifications/contract`
	// (only those two leaf entries, kept so by biome).
	"@nightshift/client": {
		layer: 5,
		mayImport: [
			"@nightshift/api",
			"@nightshift/engine",
			"@nightshift/flows",
			"@nightshift/notifications",
		],
	},
	// 6. Apps. The web app and the phone app read the API's types through
	// `@nightshift/client`, never from `@nightshift/api` itself.
	server: { layer: 6, mayImport: "lower" },
	desktop: { layer: 6, mayImport: ["@nightshift/daemon"] },
	web: {
		layer: 6,
		mayImport: ["@nightshift/client", "@nightshift/flows", "@nightshift/ui"],
	},
	mobile: {
		layer: 6,
		mayImport: [
			"@nightshift/client",
			"@nightshift/flows",
			"@nightshift/ui-native",
		],
	},
};

export const APPS = new Set(["server", "desktop", "web", "mobile"]);

/** The packages in the shadcn layout: their entries point deep (L4). */
const SHADCN = new Set(["@nightshift/ui", "@nightshift/ui-native"]);

export type Exception = { from: string; to: string; why: string };

/**
 * Known deviations of the layer map (L1), each with the change that removes
 * it, and each listed in section 8 of STRUCTURE.md. None today. The check
 * fails when an exception is no longer needed, so it cannot outlive its fix.
 */
export const EXCEPTIONS: Exception[] = [];

export type EntryException = { entry: string; why: string };

/**
 * Entries that no other workspace imports yet (L3), each listed in section
 * 8 of STRUCTURE.md with the change that removes it. The check fails once
 * another workspace imports the entry.
 */
export const ENTRY_EXCEPTIONS: EntryException[] = [];

/**
 * Entries that point past a vertical's barrel (L4), with the reason. One
 * entry per item.
 */
export const LIGHT_ENTRIES: Record<string, string> = {
	// The engine and the web app read what a harness can do without loading
	// a harness: the barrel of harnesses imports every harness adapter.
	"@nightshift/agents/harness-facts":
		"the barrel of harnesses loads every harness",
	// The barrels of these engine verticals also serve the engine's other
	// verticals (the Space move's batch, the run worktrees, the stores'
	// own parts). Their entries carry only what other workspaces use.
	"@nightshift/engine/device-config":
		"the barrel of device-config serves the engine's other verticals too",
	"@nightshift/engine/projects":
		"the barrel of projects serves the engine's other verticals too",
	// The barrel of devices' test helpers serves its own tests; the entry
	// carries only what tests of other workspaces use.
	"@nightshift/devices/testing":
		"the barrel of devices' test helpers serves its own tests too",
};

export type Options = {
	layers?: Record<string, Rule>;
	apps?: Set<string>;
	exceptions?: Exception[];
	entryExceptions?: EntryException[];
	lightEntries?: Record<string, string>;
};

export type Result = {
	problems: string[];
	/** How many workspaces it checked. */
	workspaces: number;
	/** The exceptions that a dependency or an entry still needs. */
	used: (Exception | EntryException)[];
};

type Workspace = {
	name: string;
	dir: string;
	/** Its package.json, relative to the root, with `/`. */
	file: string;
	deps: string[];
	/** Each `exports` key with its target. */
	exports: Record<string, string>;
	/** The bare specifiers its files import, and what its tsconfig extends. */
	specifiers: Set<string>;
	/** The same, from its production files only: no test imports them (L3). */
	productionSpecifiers: Set<string>;
};

/** Folders that hold no source, anywhere: installs and build output. */
const SKIP_DIRS = new Set(["node_modules", "dist"]);
/** Folders at the top of a workspace that hold no source of its own. */
const SKIP_TOP_DIRS = new Set(["build", "ios", "android"]);

const SOURCE = /\.(tsx?|mjs|cjs|js|css)$/;

/** Where a file names a module: imports, exports, require, CSS at-rules. */
const SPECIFIERS = [
	/\bfrom\s*["']([^"'\n]+)["']/g,
	/\bimport\s*["']([^"'\n]+)["']/g,
	/\bimport\s*\(\s*["']([^"'\n]+)["']/g,
	/\brequire\s*\(\s*["']([^"'\n]+)["']/g,
	/@(?:import|plugin|reference)\s+["']([^"'\n]+)["']/g,
];

function sourceFiles(dir: string, out: string[], top = false): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
			if (top && SKIP_TOP_DIRS.has(entry.name)) continue;
			sourceFiles(path, out);
		} else if (SOURCE.test(entry.name)) out.push(path);
	}
}

/** A test, by its path in the workspace (`src/runs/run.test.ts`, `test/x.ts`). */
export function isTest(path: string): boolean {
	return (
		/\.test\.tsx?$/.test(path) ||
		/(^|[\\/])test-support\.tsx?$/.test(path) ||
		/(^|[\\/])(testing|fixtures)[\\/]/.test(path) ||
		/^test[\\/]/.test(path)
	);
}

/** A package's `./testing` entry: its fakes and fixtures, for tests. */
export const isTestingEntry = (entry: string): boolean =>
	entry.endsWith("/testing");

/**
 * The bare specifiers of a workspace's files and its tsconfig `extends`,
 * and those of its production files alone.
 */
function specifiersOf(dir: string): {
	all: Set<string>;
	production: Set<string>;
} {
	const found = new Set<string>();
	const production = new Set<string>();
	const files: string[] = [];
	sourceFiles(dir, files, true);
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		const test = isTest(relative(dir, file));
		for (const pattern of SPECIFIERS) {
			for (const match of text.matchAll(pattern)) {
				const specifier = match[1] as string;
				if (specifier.startsWith(".")) continue;
				found.add(specifier);
				if (!test) production.add(specifier);
			}
		}
	}
	for (const name of readdirSync(dir)) {
		if (!/^tsconfig.*\.json$/.test(name)) continue;
		const text = readFileSync(join(dir, name), "utf8");
		const extend = /"extends"\s*:\s*(\[[^\]]*\]|"[^"]*")/.exec(text)?.[1];
		for (const match of (extend ?? "").matchAll(/"([^"]+)"/g)) {
			found.add(match[1] as string);
			production.add(match[1] as string);
		}
	}
	return { all: found, production };
}

/** `@scope/name/sub/path` → `@scope/name`, `name/sub` → `name`. */
function packageOf(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@")
		? parts.slice(0, 2).join("/")
		: (parts[0] as string);
}

function workspacesOf(root: string): Workspace[] {
	const found: Workspace[] = [];
	for (const group of ["apps", "packages"]) {
		const groupDir = join(root, group);
		if (!existsSync(groupDir)) continue;
		for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = join(groupDir, entry.name);
			const file = join(dir, "package.json");
			if (!existsSync(file)) continue;
			const pkg = JSON.parse(readFileSync(file, "utf8")) as {
				name: string;
				exports?: unknown;
				[field: string]: unknown;
			};
			const deps = new Set<string>();
			for (const field of [
				"dependencies",
				"devDependencies",
				"peerDependencies",
				"optionalDependencies",
			]) {
				const map = pkg[field] as Record<string, string> | undefined;
				for (const dep of Object.keys(map ?? {})) deps.add(dep);
			}
			const exports: Record<string, string> = {};
			if (typeof pkg.exports === "string") exports["."] = pkg.exports;
			else if (pkg.exports && typeof pkg.exports === "object") {
				for (const [key, value] of Object.entries(pkg.exports)) {
					const target =
						typeof value === "string"
							? value
							: Object.values(value as Record<string, unknown>).find(
									(v) => typeof v === "string",
								);
					if (typeof target === "string") exports[key] = target;
				}
			}
			const specifiers = specifiersOf(dir);
			found.push({
				name: pkg.name,
				dir,
				file: relative(root, file).split(sep).join("/"),
				deps: [...deps],
				exports,
				specifiers: specifiers.all,
				productionSpecifiers: specifiers.production,
			});
		}
	}
	return found;
}

/** `@nightshift/agents` + `./types` → `@nightshift/agents/types`. */
const entryName = (name: string, key: string) =>
	key === "." ? name : `${name}/${key.replace(/^\.\//, "")}`;

/** L4: the root index, a file directly in src/, or a barrel one folder down. */
const shallowEntry = (target: string) =>
	/^\.\/src\/[^/]+\.tsx?$/.test(target) ||
	/^\.\/src\/[^/]+\/index\.tsx?$/.test(target);

/** The full allow-lists of `noRestrictedImports` in biome.json (L5). */
function biomeAllowLists(
	text: string,
): { where: string; entries: Set<string> }[] {
	const lists: { where: string; entries: Set<string> }[] = [];
	const visit = (value: unknown, where: string): void => {
		if (Array.isArray(value)) {
			value.forEach((item, i) => {
				visit(item, `${where}[${i}]`);
			});
			return;
		}
		if (!value || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		const group = record.group;
		if (
			Array.isArray(group) &&
			typeof group[0] === "string" &&
			group[0].endsWith("/**") &&
			typeof record.message === "string" &&
			record.message.startsWith("Import a package by an entry")
		) {
			lists.push({
				where,
				entries: new Set(
					group
						.filter((g): g is string => typeof g === "string")
						.filter((g) => g.startsWith("!"))
						.map((g) => g.slice(1)),
				),
			});
			return;
		}
		for (const [key, inner] of Object.entries(record))
			visit(inner, where ? `${where}.${key}` : key);
	};
	visit(JSON.parse(text), "");
	return lists;
}

/**
 * The problems of the workspaces under `root` (the repository root), with
 * the layer map, the apps and the exceptions of `options`.
 */
export function checkLayers(root: string, options: Options = {}): Result {
	const layers = options.layers ?? LAYERS;
	const apps = options.apps ?? APPS;
	const exceptions = options.exceptions ?? EXCEPTIONS;
	const entryExceptions = options.entryExceptions ?? ENTRY_EXCEPTIONS;
	const lightEntries = options.lightEntries ?? LIGHT_ENTRIES;

	const allowed = (name: string): Set<string> => {
		const rule = layers[name];
		if (!rule) return new Set();
		if (rule.mayImport !== "lower") return new Set(rule.mayImport);
		return new Set(
			Object.entries(layers)
				.filter(([, other]) => other.layer < rule.layer)
				.map(([other]) => other),
		);
	};

	const all = workspacesOf(root);
	const names = new Set(all.map((ws) => ws.name));
	const problems: string[] = [];
	const used = new Set<Exception | EntryException>();

	// (L1) The layer map, and (L2) every workspace dependency is used.
	for (const ws of all) {
		const rule = layers[ws.name];
		if (!rule) {
			problems.push(
				`${ws.file}: "${ws.name}" has no layer. Add it to section 1 of docs/steering/STRUCTURE.md and to LAYERS in scripts/check-layers.ts.`,
			);
			continue;
		}
		const ok = allowed(ws.name);
		const imported = new Set([...ws.specifiers].map(packageOf));
		for (const dep of ws.deps) {
			// Only dependencies on other workspaces count.
			if (!names.has(dep)) continue;
			if (!imported.has(dep)) {
				problems.push(
					`${ws.file}: "${ws.name}" declares "${dep}", but no file imports it. Remove the dependency.`,
				);
			}
			if (EVERYWHERE.has(dep)) continue;
			const exception = exceptions.find(
				(e) => e.from === ws.name && e.to === dep,
			);
			if (exception) {
				used.add(exception);
				continue;
			}
			if (apps.has(dep)) {
				problems.push(
					`${ws.file}: "${ws.name}" depends on the app "${dep}". No workspace may depend on an app.`,
				);
				continue;
			}
			if (!ok.has(dep)) {
				const to = layers[dep];
				const list = [...ok].filter((n) => !EVERYWHERE.has(n)).sort();
				problems.push(
					`${ws.file}: "${ws.name}" (layer ${rule.layer}) may not depend on "${dep}"${to ? ` (layer ${to.layer})` : ""}. It may depend on: ${list.length ? list.join(", ") : "no other workspace"}.`,
				);
			}
		}
	}

	for (const exception of exceptions) {
		if (!used.has(exception)) {
			problems.push(
				`scripts/check-layers.ts: the exception "${exception.from}" -> "${exception.to}" is not needed any more. Remove it.`,
			);
		}
	}

	// (L3) Every entry has an importer in another workspace (a production
	// file, or a test for `./testing`), and (L4) it points at an allowed file.
	const entries = new Set<string>();
	const seenLight = new Set<string>();
	for (const ws of all) {
		for (const [key, target] of Object.entries(ws.exports)) {
			const entry = entryName(ws.name, key);
			entries.add(entry);
			if (key.includes("*")) continue;
			const testing = isTestingEntry(entry);
			const importers = all.filter(
				(other) =>
					other !== ws &&
					(testing ? other.specifiers : other.productionSpecifiers).has(entry),
			);
			const exception = entryExceptions.find((e) => e.entry === entry);
			if (exception) {
				if (importers.length) {
					problems.push(
						`scripts/check-layers.ts: ${importers.map((o) => o.name).join(", ")} import${importers.length === 1 ? "s" : ""} "${entry}" now. Remove its exception.`,
					);
				} else used.add(exception);
			} else if (!importers.length) {
				const tested = all.some(
					(other) => other !== ws && other.specifiers.has(entry),
				);
				problems.push(
					tested
						? `${ws.file}: only tests of other workspaces import the entry "${entry}". Move what they use to "${ws.name}/testing", or remove the entry from exports.`
						: `${ws.file}: no other workspace imports the entry "${entry}". Remove it from exports.`,
				);
			}
			if (SHADCN.has(ws.name)) continue;
			if (lightEntries[entry] !== undefined) {
				seenLight.add(entry);
				if (shallowEntry(target)) {
					problems.push(
						`scripts/check-layers.ts: "${entry}" points at ${target}, which an entry may name. Remove it from LIGHT_ENTRIES.`,
					);
				}
			} else if (!shallowEntry(target)) {
				problems.push(
					`${ws.file}: the entry "${entry}" points at ${target}, past a barrel. Point it at src/index.ts, a file directly in src/, or a barrel one folder down (src/<vertical>/index.ts).`,
				);
			}
		}
	}
	for (const entry of Object.keys(lightEntries)) {
		if (!seenLight.has(entry)) {
			problems.push(
				`scripts/check-layers.ts: "${entry}" is not an entry of a package.json any more. Remove it from LIGHT_ENTRIES.`,
			);
		}
	}

	// (L5) Biome's allow-lists name exactly these entries.
	const biome = join(root, "biome.json");
	if (existsSync(biome)) {
		for (const { where, entries: listed } of biomeAllowLists(
			readFileSync(biome, "utf8"),
		)) {
			const missing = [...entries].filter((e) => !listed.has(e)).sort();
			const extra = [...listed].filter((e) => !entries.has(e)).sort();
			if (missing.length) {
				problems.push(
					`biome.json: the allow-list at ${where} lacks ${missing.map((e) => `"!${e}"`).join(", ")}. Every list names every entry.`,
				);
			}
			if (extra.length) {
				problems.push(
					`biome.json: the allow-list at ${where} names ${extra.map((e) => `"!${e}"`).join(", ")}, which no package.json exports. Remove ${extra.length === 1 ? "it" : "them"}.`,
				);
			}
		}
	}

	return { problems, workspaces: all.length, used: [...used] };
}

if (import.meta.main) {
	const { problems, workspaces, used } = checkLayers(
		join(import.meta.dir, ".."),
	);
	if (problems.length) {
		console.error(
			"Layer check failed (docs/steering/STRUCTURE.md, sections 1 and 3):\n",
		);
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	const note = used.length
		? ` ${used.length} temporary exception(s): ${used.map((e) => `${"entry" in e ? e.entry : `${e.from} -> ${e.to}`} (${e.why})`).join("; ")}.`
		: "";
	console.log(`Layer check passed: ${workspaces} workspaces.${note}`);
}
