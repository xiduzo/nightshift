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
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");

/** Allowed everywhere: shared TypeScript config, no code. */
const EVERYWHERE = new Set(["@nightshift/config"]);

type Rule = {
	layer: number;
	/** The workspaces it may depend on, or "lower": every lower layer. */
	mayImport: string[] | "lower";
};

/**
 * Section 1 of STRUCTURE.md. Apps are not packages: no workspace may depend
 * on an app.
 */
const LAYERS: Record<string, Rule> = {
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
	// it to `@nightshift/api/client` (types) and the `@nightshift/flows` root.
	"@nightshift/client": {
		layer: 5,
		mayImport: ["@nightshift/api", "@nightshift/flows"],
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

const APPS = new Set(["server", "desktop", "web", "mobile"]);

/**
 * Known deviations, each with the change that removes it, and each listed
 * in section 8 of STRUCTURE.md. None today. The check fails when an
 * exception is no longer needed, so it cannot outlive its fix.
 */
const EXCEPTIONS: { from: string; to: string; why: string }[] = [];

type Workspace = { name: string; file: string; deps: string[] };

function workspaces(): Workspace[] {
	const found: Workspace[] = [];
	for (const group of ["apps", "packages"]) {
		const dir = join(root, group);
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
				file: relative(root, file),
				deps: [...deps],
			});
		}
	}
	return found;
}

function allowed(name: string): Set<string> {
	const rule = LAYERS[name];
	if (!rule) return new Set();
	if (rule.mayImport !== "lower") return new Set(rule.mayImport);
	return new Set(
		Object.entries(LAYERS)
			.filter(([, other]) => other.layer < rule.layer)
			.map(([other]) => other),
	);
}

const all = workspaces();
const names = new Set(all.map((ws) => ws.name));
const problems: string[] = [];
const usedExceptions = new Set<(typeof EXCEPTIONS)[number]>();

for (const ws of all) {
	const rule = LAYERS[ws.name];
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
		const exception = EXCEPTIONS.find(
			(e) => e.from === ws.name && e.to === dep,
		);
		if (exception) {
			usedExceptions.add(exception);
			continue;
		}
		if (APPS.has(dep)) {
			problems.push(
				`${ws.file}: "${ws.name}" depends on the app "${dep}". No workspace may depend on an app.`,
			);
			continue;
		}
		if (!ok.has(dep)) {
			const to = LAYERS[dep];
			const list = [...ok].filter((n) => !EVERYWHERE.has(n)).sort();
			problems.push(
				`${ws.file}: "${ws.name}" (layer ${rule.layer}) may not depend on "${dep}"${to ? ` (layer ${to.layer})` : ""}. It may depend on: ${list.length ? list.join(", ") : "no other workspace"}.`,
			);
		}
	}
}

for (const exception of EXCEPTIONS) {
	if (!usedExceptions.has(exception)) {
		problems.push(
			`scripts/check-layers.ts: the exception "${exception.from}" -> "${exception.to}" is not needed any more. Remove it.`,
		);
	}
}

if (problems.length) {
	console.error(
		"Layer check failed (docs/steering/STRUCTURE.md, section 1):\n",
	);
	for (const problem of problems) console.error(`- ${problem}`);
	process.exit(1);
}

const note = usedExceptions.size
	? ` ${usedExceptions.size} temporary exception(s): ${[...usedExceptions].map((e) => `${e.from} -> ${e.to} (${e.why})`).join("; ")}.`
	: "";
console.log(`Layer check passed: ${all.length} workspaces.${note}`);
