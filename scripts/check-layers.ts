/**
 * Checks the layer map of docs/steering/STRUCTURE.md (section 1).
 *
 * Every `apps/*` and `packages/*` workspace may depend only on the
 * workspaces its layer allows. Bun links only declared dependencies, so the
 * dependencies in each package.json are the real import graph between
 * workspaces. `@nightshift/config` (shared tsconfig) is allowed everywhere.
 *
 *   bun scripts/check-layers.ts
 *
 * Exits 1 and names each violation. Fix the dependency, do not add an
 * exception. If a rule is wrong, change STRUCTURE.md and this map together.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Allowed everywhere: shared TypeScript config, no code. */
const EVERYWHERE = new Set(["@nightshift/config"]);

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
	// 6. Apps
	server: { layer: 6, mayImport: "lower" },
	desktop: { layer: 6, mayImport: ["@nightshift/daemon"] },
	web: {
		layer: 6,
		mayImport: [
			"@nightshift/client",
			"@nightshift/api",
			"@nightshift/flows",
			"@nightshift/ui",
		],
	},
	mobile: {
		layer: 6,
		mayImport: [
			"@nightshift/client",
			"@nightshift/api",
			"@nightshift/flows",
			"@nightshift/ui-native",
		],
	},
};

export const APPS = new Set(["server", "desktop", "web", "mobile"]);

export type Exception = { from: string; to: string; why: string };

/**
 * Known deviations, each with the change that removes it, and each listed
 * in section 8 of STRUCTURE.md. None today. The check fails when an
 * exception is no longer needed, so it cannot outlive its fix.
 */
export const EXCEPTIONS: Exception[] = [];

export type Options = {
	layers?: Record<string, Rule>;
	apps?: Set<string>;
	exceptions?: Exception[];
};

export type Result = {
	problems: string[];
	/** How many workspaces it checked. */
	workspaces: number;
	/** The exceptions that a dependency still needs. */
	used: Exception[];
};

type Workspace = { name: string; file: string; deps: string[] };

function workspacesOf(root: string): Workspace[] {
	const found: Workspace[] = [];
	for (const group of ["apps", "packages"]) {
		const dir = join(root, group);
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const file = join(dir, entry.name, "package.json");
			if (!existsSync(file)) continue;
			const pkg = JSON.parse(readFileSync(file, "utf8")) as {
				name: string;
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
			found.push({
				name: pkg.name,
				file: relative(root, file).split(sep).join("/"),
				deps: [...deps],
			});
		}
	}
	return found;
}

/**
 * The problems of the workspaces under `root` (the repository root), with
 * the layer map, the apps and the exceptions of `options`.
 */
export function checkLayers(root: string, options: Options = {}): Result {
	const layers = options.layers ?? LAYERS;
	const apps = options.apps ?? APPS;
	const exceptions = options.exceptions ?? EXCEPTIONS;

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
	const used = new Set<Exception>();

	for (const ws of all) {
		const rule = layers[ws.name];
		if (!rule) {
			problems.push(
				`${ws.file}: "${ws.name}" has no layer. Add it to section 1 of docs/steering/STRUCTURE.md and to LAYERS in scripts/check-layers.ts.`,
			);
			continue;
		}
		const ok = allowed(ws.name);
		for (const dep of ws.deps) {
			// Only dependencies on other workspaces count.
			if (!names.has(dep)) continue;
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

	return { problems, workspaces: all.length, used: [...used] };
}

if (import.meta.main) {
	const { problems, workspaces, used } = checkLayers(
		join(import.meta.dir, ".."),
	);
	if (problems.length) {
		console.error(
			"Layer check failed (docs/steering/STRUCTURE.md, section 1):\n",
		);
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	const note = used.length
		? ` ${used.length} temporary exception(s): ${used.map((e) => `${e.from} -> ${e.to} (${e.why})`).join("; ")}.`
		: "";
	console.log(`Layer check passed: ${workspaces} workspaces.${note}`);
}
