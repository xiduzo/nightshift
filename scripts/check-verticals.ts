/**
 * Checks the vertical rules of docs/steering/STRUCTURE.md (section 4).
 *
 * It finds the verticals from the file system, so no list can drift:
 * - an app (`apps/*`): every folder in `src/features/` and `src/shared/`
 * - a package (`packages/*`): every folder directly in `src/`, except `testing/`
 *
 * For each workspace in ENFORCED it fails on:
 * (a) an import from outside a vertical into a file of it other than its
 *     `index.ts` barrel, apart from the LEAF_CONTRACTS and PEER_PORTS below;
 *     and a vertical with no `index.ts`
 * (b) a name on a barrel that no file outside the vertical imports
 * (c) a kind bucket at the top of `src/` (lib, utils, helpers, hooks,
 *     components, types, common, misc), and a loose file in an app's `shared/`
 *
 * Tests may deep-import, and they do not count as importers for (b), except
 * for a vertical named `testing`. A test is a `*.test.ts(x)` file, a
 * `test-support.ts` file, or a file in a `testing/` or `fixtures/` folder.
 * A namespace import (`import * as x`), `export * from` and a dynamic
 * `import()` that is not destructured count as a use of every name.
 *
 *   bun scripts/check-verticals.ts                 every workspace in ENFORCED
 *   bun scripts/check-verticals.ts packages/engine  that workspace (enforced or not)
 *
 * Exits 1 and names each violation. Fix the import, do not add an exception.
 * When a workspace is cut into verticals, add it to ENFORCED.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

/**
 * The workspaces that follow section 4. Each structure phase adds the
 * workspaces it converts. Phase 8 removes the list: then every workspace
 * except `packages/ui` and `packages/config` is checked.
 */
export const ENFORCED: string[] = [
	"apps/desktop",
	"apps/server",
	"apps/web",
	"packages/agents",
	"packages/api",
	"packages/daemon",
	"packages/engine",
	"packages/flows",
];

/**
 * Leaf contracts: a pure-data file (no imports of its own) that a vertical
 * exposes past its barrel, because importing the barrel would close a
 * module-init cycle. Its names are on the barrel too. One entry per file,
 * with a comment that says why.
 *
 * Shape: { workspace: { vertical: ["path/inside/the/vertical" (no extension)] } }
 * A vertical is named by its path in `src/`: `features/runs`, `shared/api`, `graph`.
 */
export const LEAF_CONTRACTS: Record<string, Record<string, string[]>> = {};

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
			// Walker). The status badge imports only the API types.
			"features/runs": "components/run-status-badge",
			// This computer's card reads and saves its Host addresses in the
			// settings. The settings page imports runs, and runs imports devices.
			"features/settings": "queries",
		},
		"features/flows": {
			// The editor reads the new-node defaults, the flow list creates a
			// flow with them. The settings page counts the flows of a project.
			"features/settings": "queries",
			// Start run starts a run and reads a project's runs and Devices.
			// The run page imports the flow canvas.
			"features/runs": "queries",
		},
		"features/gates": {
			// The inbox lists sleeping runs and refreshes the runs after an
			// answer. The run page imports the gate question and answer.
			"features/runs": "queries",
		},
	},
};

/** Kind buckets: never a folder at the top of `src/`. */
const KIND_BUCKETS = new Set([
	"lib",
	"utils",
	"helpers",
	"hooks",
	"components",
	"types",
	"common",
	"misc",
]);

const SKIP_DIRS = new Set(["node_modules", "dist", ".hutch", ".turbo"]);

export type Options = {
	leafContracts?: Record<string, string[]>;
	peerPorts?: Record<string, Record<string, string>>;
};

type Import = {
	specifier: string;
	/** The names it uses, or "all" (namespace, `export *`, plain `import()`). */
	names: string[] | "all";
};

type SourceFile = {
	path: string;
	test: boolean;
	imports: Import[];
	exports: { names: string[]; stars: string[] };
};

export function isTest(path: string): boolean {
	return (
		/\.test\.tsx?$/.test(path) ||
		/(^|[\\/])test-support\.tsx?$/.test(path) ||
		/(^|[\\/])(testing|fixtures)[\\/]/.test(path)
	);
}

function walk(dir: string, out: string[]): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path, out);
		else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
			out.push(path);
	}
}

function bindingNames(clause: ts.ImportClause | undefined): string[] | "all" {
	if (!clause) return [];
	const names: string[] = [];
	if (clause.name) names.push("default");
	const bindings = clause.namedBindings;
	if (bindings && ts.isNamespaceImport(bindings)) return "all";
	if (bindings && ts.isNamedImports(bindings)) {
		for (const element of bindings.elements) {
			names.push((element.propertyName ?? element.name).text);
		}
	}
	return names;
}

/** `const { a, b: c } = await import("x")`: the names a and b. */
function destructured(call: ts.CallExpression): string[] | "all" {
	let node: ts.Node = call.parent;
	while (
		node &&
		(ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node))
	)
		node = node.parent;
	if (
		node &&
		ts.isVariableDeclaration(node) &&
		ts.isObjectBindingPattern(node.name)
	) {
		const names: string[] = [];
		for (const element of node.name.elements) {
			if (element.dotDotDotToken) return "all";
			const key = element.propertyName ?? element.name;
			if (ts.isIdentifier(key) || ts.isStringLiteral(key)) names.push(key.text);
			else return "all";
		}
		return names;
	}
	return "all";
}

function parse(path: string): SourceFile {
	const text = readFileSync(path, "utf8");
	const source = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true,
		path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const imports: Import[] = [];
	const exportNames: string[] = [];
	const stars: string[] = [];
	const exported = (node: ts.Node) =>
		ts.canHaveModifiers(node) &&
		(ts.getModifiers(node) ?? []).some(
			(m) => m.kind === ts.SyntaxKind.ExportKeyword,
		);
	const visit = (node: ts.Node): void => {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			imports.push({
				specifier: node.moduleSpecifier.text,
				names: bindingNames(node.importClause),
			});
		} else if (ts.isExportDeclaration(node)) {
			const clause = node.exportClause;
			if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				const specifier = node.moduleSpecifier.text;
				if (!clause) {
					imports.push({ specifier, names: "all" });
					stars.push(specifier);
				} else if (ts.isNamespaceExport(clause)) {
					imports.push({ specifier, names: "all" });
					exportNames.push(clause.name.text);
				} else {
					imports.push({
						specifier,
						names: clause.elements.map((e) => (e.propertyName ?? e.name).text),
					});
					exportNames.push(...clause.elements.map((e) => e.name.text));
				}
			} else if (clause && ts.isNamedExports(clause)) {
				exportNames.push(...clause.elements.map((e) => e.name.text));
			}
		} else if (ts.isExportAssignment(node)) {
			exportNames.push("default");
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments[0] &&
			ts.isStringLiteralLike(node.arguments[0])
		) {
			imports.push({
				specifier: node.arguments[0].text,
				names: destructured(node),
			});
		} else if (ts.isImportEqualsDeclaration(node)) {
			const ref = node.moduleReference;
			if (
				ts.isExternalModuleReference(ref) &&
				ts.isStringLiteral(ref.expression)
			) {
				imports.push({ specifier: ref.expression.text, names: "all" });
			}
		} else if (exported(node)) {
			const isDefault = (ts.getModifiers(node as ts.HasModifiers) ?? []).some(
				(m) => m.kind === ts.SyntaxKind.DefaultKeyword,
			);
			if (isDefault) exportNames.push("default");
			else if (ts.isVariableStatement(node)) {
				for (const declaration of node.declarationList.declarations) {
					if (ts.isIdentifier(declaration.name))
						exportNames.push(declaration.name.text);
				}
			} else if (
				(ts.isFunctionDeclaration(node) ||
					ts.isClassDeclaration(node) ||
					ts.isInterfaceDeclaration(node) ||
					ts.isTypeAliasDeclaration(node) ||
					ts.isEnumDeclaration(node) ||
					ts.isModuleDeclaration(node)) &&
				node.name &&
				ts.isIdentifier(node.name)
			) {
				exportNames.push(node.name.text);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return {
		path,
		test: false,
		imports,
		exports: { names: exportNames, stars },
	};
}

/** `"@/*": ["./src/*"]` style aliases of the workspace tsconfig. */
function aliases(workspace: string): { prefix: string; target: string }[] {
	const file = join(workspace, "tsconfig.json");
	if (!existsSync(file)) return [];
	const { config } = ts.parseConfigFileTextToJson(
		file,
		readFileSync(file, "utf8"),
	);
	const options = config?.compilerOptions ?? {};
	const base = resolve(workspace, options.baseUrl ?? ".");
	const found: { prefix: string; target: string }[] = [];
	for (const [key, targets] of Object.entries(
		(options.paths ?? {}) as Record<string, string[]>,
	)) {
		const target = targets[0];
		if (!key.endsWith("/*") || !target?.endsWith("/*")) continue;
		found.push({
			prefix: key.slice(0, -1),
			target: resolve(base, target.slice(0, -2)),
		});
	}
	return found;
}

function resolveFile(base: string): string | undefined {
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		join(base, "index.tsx"),
	];
	if (/\.jsx?$/.test(base))
		candidates.push(
			base.replace(/\.jsx?$/, ".ts"),
			base.replace(/\.jsx?$/, ".tsx"),
		);
	return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

type Vertical = { name: string; dir: string; barrel?: string };

function verticalsOf(src: string, app: boolean): Vertical[] {
	const roots = app
		? [
				{ dir: join(src, "features"), prefix: "features/" },
				{ dir: join(src, "shared"), prefix: "shared/" },
			]
		: [{ dir: src, prefix: "" }];
	const found: Vertical[] = [];
	for (const { dir, prefix } of roots) {
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
			if (!app && entry.name === "testing") continue;
			const path = join(dir, entry.name);
			found.push({
				name: `${prefix}${entry.name}`,
				dir: path,
				barrel: resolveFile(join(path, "index")),
			});
		}
	}
	return found;
}

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
	const problems: string[] = [];

	if (!existsSync(src)) return [`${workspace}: has no src/ folder.`];

	// (c) Top-level layout.
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		if (entry.isDirectory() && KIND_BUCKETS.has(entry.name)) {
			problems.push(
				`${rel(join(src, entry.name))}/: "${entry.name}" is a kind bucket. Move each file into the vertical that uses it (${app ? "src/features/<vertical>/ or a named src/shared/<name>/" : "src/<vertical>/"}).`,
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

	const files = new Map<string, SourceFile>();
	const paths: string[] = [];
	walk(src, paths);
	for (const path of paths) {
		const file = parse(path);
		file.test = isTest(relative(src, path));
		files.set(path, file);
	}

	const pathAliases = aliases(wsDir);
	const resolveImport = (from: string, specifier: string) => {
		if (specifier.startsWith(".")) {
			return resolveFile(resolve(dirname(from), specifier));
		}
		for (const alias of pathAliases) {
			if (specifier.startsWith(alias.prefix)) {
				return resolveFile(
					join(alias.target, specifier.slice(alias.prefix.length)),
				);
			}
		}
		return undefined;
	};

	const leafContracts = options.leafContracts ?? {};
	const peerPorts = options.peerPorts ?? {};
	const exempt = (
		from: Vertical | undefined,
		to: Vertical,
		target: string,
	): boolean => {
		const inside = relative(to.dir, target)
			.split(sep)
			.join("/")
			.replace(/\.tsx?$/, "");
		if ((leafContracts[to.name] ?? []).includes(inside)) return true;
		if (from && peerPorts[from.name]?.[to.name] === inside) return true;
		return false;
	};
	const barrelSpecifier = (from: string, to: Vertical) => {
		const atAlias = pathAliases.find((a) => a.target === src);
		if (atAlias) return `${atAlias.prefix}${to.name}`;
		const path = relative(dirname(from), to.dir).split(sep).join("/");
		return path.startsWith(".") ? path : `./${path}`;
	};

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

	for (const file of files.values()) {
		const from = verticalOf(file.path);
		for (const imported of file.imports) {
			const target = resolveImport(file.path, imported.specifier);
			if (!target) continue;
			const to = verticalOf(target);
			if (!to || to === from) continue;
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

	// (b) Barrel reachability.
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
		if (!vertical.barrel) continue;
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

	return problems;
}

if (import.meta.main) {
	const started = performance.now();
	const root = join(import.meta.dir, "..");
	const args = process.argv.slice(2);
	const workspaces = args.length ? args : ENFORCED;
	const problems: string[] = [];
	for (const workspace of workspaces) {
		if (!existsSync(join(root, workspace, "package.json"))) {
			problems.push(`${workspace}: is not a workspace.`);
			continue;
		}
		problems.push(
			...checkWorkspace(root, workspace, {
				leafContracts: LEAF_CONTRACTS[workspace],
				peerPorts: PEER_PORTS[workspace],
			}),
		);
	}
	if (problems.length) {
		console.error(
			"Vertical check failed (docs/steering/STRUCTURE.md, section 4):\n",
		);
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	const ms = Math.round(performance.now() - started);
	console.log(
		workspaces.length
			? `Vertical check passed: ${workspaces.join(", ")} (${ms} ms).`
			: "Vertical check passed: no workspace is enforced yet (ENFORCED in scripts/check-verticals.ts).",
	);
}
