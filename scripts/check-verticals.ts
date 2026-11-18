/**
 * Checks the vertical rules of docs/steering/STRUCTURE.md (sections 4 and 5).
 *
 * It finds the verticals from the file system, so no list can drift:
 * - an app (`apps/*`): every folder in `src/features/` and `src/shared/`
 * - a package (`packages/*`): every folder directly in `src/`, except `testing/`
 *
 * It checks every workspace in `apps/` and `packages/` except `packages/ui`
 * and `packages/ui-native` (the shadcn layout) and `packages/config` (no code). It finds those from
 * the file system too, so a new workspace is checked from its first commit.
 * For each workspace it fails on:
 * (a) an import from outside a vertical into a file of it other than its
 *     `index.ts` barrel, apart from the LEAF_CONTRACTS and PEER_PORTS below;
 *     and a vertical with no `index.ts`
 * (b) a name on a barrel that no file outside the vertical imports. A
 *     barrel that `package.json` `exports` names is a public entry of the
 *     package (`@nightshift/db/migrate`): rule (m) checks it, like the root
 *     `index.ts`
 * (c) a kind bucket at the top of `src/` (lib, utils, helpers, hooks,
 *     components, types, common, misc), and a loose file in an app's `shared/`
 * (d) a relative import that leaves the workspace
 * (e) an import of the workspace's own package name
 * (f) production code that imports a test, a fake, a fixture or a test helper
 * (g) a folder at the top of an app's `src/` other than `features/`,
 *     `shared/` and the app's ENTRY_DIRS
 * (h) in an app, a shared piece that imports a feature, and a vertical that
 *     imports `shared/shell` (only the routes and the entry files compose it)
 * (i) a peer port, or a file of its vertical that it imports, that imports
 *     another vertical than a shared piece
 * (j) a barrel, or a package's root `index.ts`, with a statement that is
 *     not an import or an export
 * (k) a catch-all name at any depth: a file named utils, util, helpers,
 *     helper, common, misc or shared, and a folder named utils, util,
 *     helpers, helper, common or misc
 * (l) a cycle between the verticals of a workspace, `import type`
 *     included. An import through a peer port or of a leaf contract is
 *     not part of a cycle, nor is a test. KNOWN_CYCLES lists the ones that
 *     wait for their fix
 * (n) a kind folder inside a vertical, at any depth: a folder named
 *     components, hooks, lib, types, queries or mutations. (The other kind
 *     names, utils, helpers, common and misc, fail as catch-all names (k).)
 * (o) a sub-vertical that breaks a barrel rule. A folder inside a vertical
 *     that has its own `index.ts` is a sub-vertical, at every depth. It
 *     fails on an import from outside the sub-vertical, but inside its
 *     vertical, into a file of it other than that barrel. It fails on a
 *     statement on that barrel that is not an import or an export, and on
 *     a name on it that no file outside the sub-vertical imports
 * (p) a vertical or a sub-vertical with more than 25 source files or more
 *     than 5,000 lines (tests do not count, everything below it does) that
 *     does not consist of sub-verticals: a folder directly in it that has
 *     no `index.ts`, and own code over the same two limits. Its own code
 *     is the files directly in it and in its ring folders
 * And across the workspaces it checks:
 * (m) a name on a package entry that no production file of another
 *     workspace imports. A test counts only for a `./testing` entry. A
 *     type may stay when a used name's declaration writes it, in turn
 *     (`checkEntries`. PENDING_NAMES wait for their importer)
 *
 * The ring folders of a slice (`domain/`, `application/`, `adapters/`,
 * `adapters/in/` and `adapters/out/`, directly in a vertical or a
 * sub-vertical) are not sub-verticals for (o) and (p): they need no
 * barrel, and an `index.ts` in one makes no barrel. A folder in a ring
 * folder counts as a folder directly in the vertical.
 *
 * Rules (n), (o) and (p) started with a debt list each, for what broke them
 * that day: `scripts/kind-folder-debt.txt` (n) and `scripts/nesting-debt.txt`
 * (o, p). An offender that is not on its list fails. A line fails once it
 * is clean, so a list only gets shorter.
 *
 * It reads every file of the workspace, not only `src/`. A file outside
 * `src/` (a config file, a script) belongs to no vertical: it imports a
 * vertical through its barrel, and it counts as an importer for (b).
 *
 * Tests may deep-import, and they do not count as importers for (b) and
 * (o), except for a vertical named `testing`. A test is a `*.test.ts(x)` file, a
 * `test-support.ts` file, a file in a `testing/` or `fixtures/` folder, or a
 * file in the workspace's `test/` folder.
 * A namespace import (`import * as x`), `export * from` and a dynamic
 * `import()` or `require()` that is not destructured count as a use of
 * every name. A type written as `import("x").Name` counts as an import.
 *
 *   bun scripts/check-verticals.ts                  every workspace
 *   bun scripts/check-verticals.ts packages/engine  only that workspace
 *
 * Exits 1 and names each violation. Fix the import, do not add an exception
 * or a line to a debt list.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ENTRY_EXCEPTIONS } from "./check-layers";
import {
	debtList,
	KIND_FOLDER_DEBT,
	linesOf,
	NESTING_DEBT,
} from "./verticals/debt";
import { entryProblems } from "./verticals/entries";
import { checkWorkspace } from "./verticals/workspace";

// The rules live in `scripts/verticals/`. This file is the command, and it
// holds the listed exceptions. The other check scripts read a workspace
// with the same reader, so it is exported here too.
export {
	aliases,
	entryFiles,
	packageJson,
	resolveFile,
	resolverFor,
} from "./verticals/resolve";
export {
	type Import,
	parse,
	type SourceFile,
	walk,
} from "./verticals/source-file";
export { type Vertical, verticalsOf } from "./verticals/vertical";
export { checkWorkspace, type Options } from "./verticals/workspace";

/**
 * The workspaces that section 4 does not cover: `ui` and `ui-native` (React
 * Native Reusables, shadcn for React Native) keep the shadcn layout
 * (`components/`, `hooks/`, `lib/`), and `config` holds no code.
 */
export const NOT_CHECKED = new Set([
	"packages/ui",
	"packages/ui-native",
	"packages/config",
]);

/**
 * Every workspace that section 4 covers, sorted: each folder in `apps/` and
 * `packages/` with a `package.json`, except NOT_CHECKED.
 */
export function workspacesOf(root: string): string[] {
	const found: string[] = [];
	for (const group of ["apps", "packages"]) {
		const dir = join(root, group);
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const workspace = `${group}/${entry.name}`;
			if (!entry.isDirectory() || NOT_CHECKED.has(workspace)) continue;
			if (existsSync(join(dir, entry.name, "package.json")))
				found.push(workspace);
		}
	}
	return found.sort();
}

/**
 * Leaf contracts: a pure-data file (no imports of its own) that a vertical
 * exposes past its barrel, because importing the barrel would close a
 * module-init cycle or load what the importer cannot load. One entry per
 * file, with a comment that says why. The check fails on a leaf contract
 * that imports anything, and on one that nothing imports any more.
 *
 * Shape: { workspace: { vertical: ["path/inside/the/vertical" (no extension)] } }
 * A vertical is named by its path in `src/`: `features/runs`, `shared/api`, `graph`.
 */
export const LEAF_CONTRACTS: Record<string, Record<string, string[]>> = {
	"apps/desktop": {
		// The build config (electrobun.config.ts) reads the update feeds. The
		// barrel of updates loads electrobun/main, which only the app's main
		// process can load.
		"features/updates": ["update-feeds"],
	},
};

/**
 * Peer ports: two verticals that depend on each other cross only through one
 * named port file per direction. Every other deep import between them stays
 * an error. One entry per direction, with a comment that says why.
 *
 * Shape: { workspace: { fromVertical: { toVertical: "port/file/in/toVertical" } } }
 */
export const PEER_PORTS: Record<
	string,
	Record<string, Record<string, string>>
> = {
	"apps/web": {
		// A vertical's queries.ts imports only shared/api. A vertical below the
		// owner in the order of STRUCTURE.md section 5 that needs the owner's
		// data reads it through that file: the owner's barrel would close a
		// cycle, because the owner's pages import the lower vertical.
		"features/agents": {
			// The Agents page reads the settings and saves a program's path.
			// The settings page shows the agent defaults with the harnesses.
			"features/settings": "queries",
			// The Agents page makes and withdraws the Offers of a profile. The
			// Devices page shows the Offers with the withdraw dialog of agents.
			"features/devices": "queries",
		},
		"features/devices": {
			// Runs and devices show each other: a run shows its Walker (a
			// Device), and the Offers of a Device list the runs they started,
			// with their status. Through the runs barrel the devices page would
			// close a devices -> runs -> devices cycle (run-details shows the
			// Walker). The status badge imports only the API types. It is a
			// file of the `status` sub-vertical of runs: the port names the
			// file, not that barrel, so it reaches nothing else.
			"features/runs": "status/run-status-badge",
			// This computer's card reads and saves its Host addresses in the
			// settings. The settings page imports runs, and runs imports devices.
			"features/settings": "queries",
		},
		"features/flows": {
			// The editor reads the new-node defaults, the flow list creates a
			// flow with them. The settings page counts the flows of a project.
			"features/settings": "queries",
			// Start run starts a run and reads a project's runs and Devices.
			// The Flows page shows each flow's last runs with their status.
			// The run page imports the flow canvas.
			"features/runs": "flows-port",
			// The Flows page shows each flow's last runs (Flow health). The
			// project's dashboard lists the flows.
			"features/dashboard": "queries",
		},
		"features/gates": {
			// The inbox lists sleeping runs and refreshes the runs after an
			// answer. The run page imports the gate question and answer.
			"features/runs": "queries",
		},
		"features/projects": {
			// Adding the starter flows asks which of your profiles takes each
			// agent they name. The agents pages import projects (a project's
			// secrets), so the agents barrel would close a cycle. The step
			// imports only the agents' queries and harnesses.
			"features/agents": "flow-agents-step",
		},
	},
};

/**
 * Known cycles between verticals, each listed in section 8 of STRUCTURE.md
 * with the change that removes it. The cycle check skips the imports of a
 * listed vertical, and fails once the vertical is in no cycle.
 *
 * Shape: { workspace: ["vertical"] }
 */
export const KNOWN_CYCLES: Record<string, string[]> = {};

/**
 * The folders at the top of an app's `src/` besides `features/` and
 * `shared/`: the one folder of entry files that its framework reads.
 */
export const ENTRY_DIRS: Record<string, string[]> = {
	// TanStack Router's file routes.
	"apps/web": ["routes"],
	"apps/insights": ["routes"],
	// Expo Router's files.
	"apps/mobile": ["app"],
	// Electrobun's main process entry.
	"apps/desktop": ["bun"],
};

/**
 * Value names on an entry that no workspace of this branch imports yet,
 * because the code that imports them is on its way. A name fails once a
 * workspace imports it, so the list empties itself as that code lands. Each
 * name is listed in section 8 of STRUCTURE.md.
 *
 * Shape: { entry: ["name"] }
 */
export const PENDING_NAMES: Record<string, string[]> = {};

/**
 * (m) The names on the package entries of `workspaces`, with the listed
 * exceptions: ENTRY_EXCEPTIONS of check-layers and PENDING_NAMES above.
 * `entryProblems` holds the rule.
 */
export function checkEntries(
	root: string,
	workspaces: string[],
	{
		exceptions = ENTRY_EXCEPTIONS.map((e) => e.entry),
		pending = PENDING_NAMES,
	}: { exceptions?: string[]; pending?: Record<string, string[]> } = {},
): string[] {
	return entryProblems(root, workspaces, {
		exceptions,
		pending,
		notChecked: NOT_CHECKED,
	});
}

/**
 * The problems of each named workspace, with the listed exceptions and the
 * debt lists of each, and of the entries of those workspaces. A name that
 * is not a workspace is a problem too. So is a line of a debt list that
 * names no checked workspace.
 */
export function checkWorkspaces(root: string, workspaces: string[]): string[] {
	const problems: string[] = [];
	const kindFolderDebt = debtList(root, KIND_FOLDER_DEBT);
	const nestingDebt = debtList(root, NESTING_DEBT);
	const checked = workspacesOf(root);
	for (const [file, lines] of [
		[KIND_FOLDER_DEBT, kindFolderDebt],
		[NESTING_DEBT, nestingDebt],
	] as const) {
		for (const line of lines) {
			if (!checked.some((workspace) => line.startsWith(`${workspace}/`)))
				problems.push(
					`${file}: "${line}" names no path of a checked workspace. Remove the line.`,
				);
		}
	}
	for (const workspace of workspaces) {
		if (!existsSync(join(root, workspace, "package.json"))) {
			problems.push(`${workspace}: is not a workspace.`);
			continue;
		}
		problems.push(
			...checkWorkspace(root, workspace, {
				leafContracts: LEAF_CONTRACTS[workspace],
				peerPorts: PEER_PORTS[workspace],
				entryDirs: ENTRY_DIRS[workspace],
				knownCycles: KNOWN_CYCLES[workspace],
				kindFolderDebt: linesOf(kindFolderDebt, workspace),
				nestingDebt: linesOf(nestingDebt, workspace),
			}),
		);
	}
	problems.push(...checkEntries(root, workspaces));
	return problems;
}

if (import.meta.main) {
	const started = performance.now();
	const root = join(import.meta.dir, "..");
	const args = process.argv.slice(2);
	const workspaces = args.length ? args : workspacesOf(root);
	const problems = checkWorkspaces(root, workspaces);
	if (problems.length) {
		console.error(
			"Vertical check failed (docs/steering/STRUCTURE.md, sections 4 and 5):\n",
		);
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	const ms = Math.round(performance.now() - started);
	console.log(`Vertical check passed: ${workspaces.join(", ")} (${ms} ms).`);
}
