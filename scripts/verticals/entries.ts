/**
 * The names on the package entries: rule (m) of
 * `scripts/check-verticals.ts`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "@typescript/typescript6";

import { isTest, isTestingEntry } from "../check-layers";
import { packageJson, resolveFile, resolverFor } from "./resolve";
import { parse, type SourceFile, walk } from "./source-file";

/** Every folder in `apps/` and `packages/` with a `package.json`, sorted. */
function allWorkspaces(root: string): string[] {
	const found: string[] = [];
	for (const group of ["apps", "packages"]) {
		const dir = join(root, group);
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (
				entry.isDirectory() &&
				existsSync(join(dir, entry.name, "package.json"))
			)
				found.push(`${group}/${entry.name}`);
		}
	}
	return found.sort();
}

type Entry = {
	/** How another workspace imports it: `@nightshift/db/migrate`. */
	specifier: string;
	/** The name of its package: `@nightshift/db`. */
	pkg: string;
	file: string;
	workspace: string;
	/** The vertical folder of the file, or the file itself at the top of src/. */
	home: string;
};

const declarations = new Map<string, ts.SourceFile>();

/**
 * The names that the declarations of `names`, exported from `file`, write,
 * in turn: a type's text, a function's parameters and return type (its
 * body too when it writes no return type, because then the body gives the
 * type), a constant's type, or its value when it writes no type. A name
 * that such a declaration writes and its file declares or imports from the
 * package is read in turn. A name from another package ends the walk.
 */
function namesWritten(file: string, names: Iterable<string>): Set<string> {
	const found = new Set<string>();
	const seen = new Set<string>();
	const sourceOf = (path: string): ts.SourceFile => {
		let source = declarations.get(path);
		if (!source) {
			source = ts.createSourceFile(
				path,
				readFileSync(path, "utf8"),
				ts.ScriptTarget.Latest,
				true,
				path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
			);
			declarations.set(path, source);
		}
		return source;
	};
	const visit = (path: string, name: string): void => {
		const key = `${path}\0${name}`;
		if (seen.has(key)) return;
		seen.add(key);
		const source = sourceOf(path);
		const follow = (specifier: string, imported: string) => {
			if (!specifier.startsWith(".")) return;
			const target = resolveFile(resolve(dirname(path), specifier));
			if (target) visit(target, imported);
		};
		const written: string[] = [];
		const collect = (node: ts.Node): void => {
			if (ts.isIdentifier(node)) written.push(node.text);
			const typed =
				(ts.isFunctionLike(node) && "body" in node && node.body && node.type) ||
				(ts.isVariableDeclaration(node) && node.type);
			if (typed) {
				const skip = ts.isVariableDeclaration(node)
					? node.initializer
					: (node as ts.FunctionLikeDeclaration).body;
				ts.forEachChild(node, (child) => {
					if (child !== skip) collect(child);
				});
				return;
			}
			ts.forEachChild(node, collect);
		};
		for (const statement of source.statements) {
			if (ts.isExportDeclaration(statement)) {
				const clause = statement.exportClause;
				if (!clause || !ts.isNamedExports(clause)) continue;
				for (const element of clause.elements) {
					if (element.name.text !== name) continue;
					const imported = (element.propertyName ?? element.name).text;
					if (
						statement.moduleSpecifier &&
						ts.isStringLiteral(statement.moduleSpecifier)
					)
						follow(statement.moduleSpecifier.text, imported);
					else if (imported !== name) visit(path, imported);
				}
			} else if (
				ts.isImportDeclaration(statement) &&
				ts.isStringLiteral(statement.moduleSpecifier)
			) {
				const named = statement.importClause?.namedBindings;
				if (named && ts.isNamedImports(named))
					for (const element of named.elements)
						if (element.name.text === name)
							follow(
								statement.moduleSpecifier.text,
								(element.propertyName ?? element.name).text,
							);
			} else if (ts.isVariableStatement(statement)) {
				for (const declaration of statement.declarationList.declarations)
					if (
						ts.isIdentifier(declaration.name) &&
						declaration.name.text === name
					)
						collect(declaration);
			} else if (
				(ts.isFunctionDeclaration(statement) ||
					ts.isClassDeclaration(statement) ||
					ts.isInterfaceDeclaration(statement) ||
					ts.isTypeAliasDeclaration(statement) ||
					ts.isEnumDeclaration(statement) ||
					ts.isModuleDeclaration(statement)) &&
				statement.name?.text === name
			) {
				collect(statement);
			}
		}
		for (const id of written) {
			if (id === name) continue;
			found.add(id);
			visit(path, id);
		}
	};
	for (const name of names) visit(file, name);
	return found;
}

/**
 * (m) Every name on a package entry has an importer: a production file of
 * another workspace imports or re-exports it. A test counts only for a
 * `./testing` entry, so a name that only tests use goes to the package's
 * `./testing`. A production file of the entry's own package outside the
 * entry's vertical counts as well, but an entry file (the root index that
 * re-exports a vertical's barrel) counts only for the names it passes on
 * that are used in turn.
 *
 * A type without an importer may stay when the declaration of a used name
 * on the same entry writes it (`namesWritten`), in turn: another package's
 * emitted declaration can name it without importing it (TS2883). The check
 * reads what the declarations write, not what TypeScript infers. When
 * `tsc` needs a type that no declaration writes, write it (a return type).
 * The names that `export *` passes on are not checked (only the drizzle
 * schema has it).
 * A wildcard entry, an entry of `notChecked` (NOT_CHECKED), and an entry
 * in `exceptions` (ENTRY_EXCEPTIONS of check-layers) are not checked.
 * `pending` is PENDING_NAMES.
 *
 * `workspaces` are the workspaces whose entries it checks. The files of
 * every workspace count as importers.
 */
export function entryProblems(
	root: string,
	workspaces: string[],
	{
		exceptions,
		pending,
		notChecked,
	}: {
		exceptions: string[];
		pending: Record<string, string[]>;
		notChecked: Set<string>;
	},
): string[] {
	const rel = (path: string) => relative(root, path).split(sep).join("/");
	const all = allWorkspaces(root);

	const entries: Entry[] = [];
	const bySpecifier = new Map<string, Entry>();
	const byFile = new Map<string, Entry>();
	for (const workspace of all) {
		const wsDir = resolve(root, workspace);
		const { name, exports } = packageJson(wsDir);
		if (!name || !exports || typeof exports !== "object") continue;
		for (const [key, value] of Object.entries(exports)) {
			if (key.includes("*")) continue;
			const target =
				typeof value === "string"
					? value
					: Object.values(value as Record<string, unknown>).find(
							(v): v is string => typeof v === "string",
						);
			if (!target || !/\.tsx?$/.test(target)) continue;
			const file = resolve(wsDir, target);
			if (!existsSync(file)) continue;
			const src = join(wsDir, "src");
			const top = relative(src, file).split(sep);
			const entry: Entry = {
				specifier: key === "." ? name : `${name}/${key.replace(/^\.\//, "")}`,
				pkg: name,
				file,
				workspace,
				home: top.length > 1 ? join(src, top[0] as string) : file,
			};
			entries.push(entry);
			bySpecifier.set(entry.specifier, entry);
			if (!byFile.has(file)) byFile.set(file, entry);
		}
	}

	const uses = new Map<string, Set<string> | "all">();
	/** The names that only tests of another workspace import, per entry file. */
	const tested = new Map<string, Set<string>>();
	/** Adds the names to the uses of an entry file. True when it grew. */
	const mark = (file: string, names: string[] | "all"): boolean => {
		const current = uses.get(file);
		if (current === "all") return false;
		if (names === "all") {
			uses.set(file, "all");
			return true;
		}
		const set = current ?? new Set<string>();
		const before = set.size;
		for (const name of names) set.add(name);
		uses.set(file, set);
		return set.size > before;
	};

	// Another workspace's imports and re-exports: its production files, and
	// its tests for a `./testing` entry. And the imports of an entry file
	// inside its own package, kept for below.
	const inPackage: {
		entry: Entry;
		file: SourceFile;
		specifier: string;
		names: string[] | "all";
	}[] = [];
	for (const workspace of all) {
		const wsDir = resolve(root, workspace);
		const resolveImport = resolverFor(wsDir);
		const paths: string[] = [];
		walk(wsDir, paths, true);
		for (const path of paths) {
			const file = parse(path);
			file.test = isTest(relative(wsDir, path));
			for (const imported of file.imports) {
				const entry = bySpecifier.get(imported.specifier);
				if (entry) {
					if (entry.workspace === workspace) continue;
					if (!file.test || isTestingEntry(entry.specifier))
						mark(entry.file, imported.names);
					else if (imported.names !== "all") {
						const set = tested.get(entry.file) ?? new Set<string>();
						for (const name of imported.names) set.add(name);
						tested.set(entry.file, set);
					}
					continue;
				}
				if (file.test) continue;
				if (!/^[.@]/.test(imported.specifier)) continue;
				const target = resolveImport(path, imported.specifier);
				const own = target ? byFile.get(target) : undefined;
				if (
					own &&
					own.workspace === workspace &&
					path !== own.file &&
					!(path === own.home || path.startsWith(`${own.home}${sep}`))
				) {
					inPackage.push({
						entry: own,
						file,
						specifier: imported.specifier,
						names: imported.names,
					});
				}
			}
		}
	}

	/** The names of `specifier` that an entry file passes on and are used. */
	const passedOn = (file: SourceFile, specifier: string): string[] | "all" => {
		const used = uses.get(file.path);
		if (file.exports.stars.includes(specifier))
			return used === "all" ? "all" : [...(used ?? [])];
		const isUsed = (name: string) => used === "all" || !!used?.has(name);
		const names: string[] = [];
		for (const r of file.reexports) {
			if (r.specifier !== specifier || !isUsed(r.exported)) continue;
			if (r.imported === "*") return "all";
			names.push(r.imported);
		}
		for (const [local, binding] of file.bindings) {
			if (binding.specifier !== specifier) continue;
			const exports = file.localExports.filter((e) => e.local === local);
			// A name it imports for its own code is a use.
			if (exports.length && !exports.some((e) => isUsed(e.exported))) continue;
			if (binding.imported === "*") return "all";
			names.push(binding.imported);
		}
		return names;
	};
	for (let changed = true; changed; ) {
		changed = false;
		for (const { entry, file, specifier, names } of inPackage) {
			const passed = byFile.has(file.path) ? passedOn(file, specifier) : names;
			if (mark(entry.file, passed)) changed = true;
		}
	}

	const problems: string[] = [];
	for (const entry of entries) {
		if (!workspaces.includes(entry.workspace)) continue;
		if (notChecked.has(entry.workspace)) continue;
		if (exceptions.includes(entry.specifier)) continue;
		const used = uses.get(entry.file);
		const { values, exports } = parse(entry.file);
		const waiting = pending[entry.specifier] ?? [];
		for (const name of waiting) {
			if (!values.has(name) || used === "all" || used?.has(name)) {
				problems.push(
					`scripts/check-verticals.ts: "${name}" of "${entry.specifier}" ${values.has(name) ? "has an importer now" : "is not on the entry any more"}. Remove it from PENDING_NAMES.`,
				);
			}
		}
		if (used === "all") continue;
		// The types that the declarations of the used names write, in turn.
		const reached = namesWritten(
			entry.file,
			exports.names.filter((name) => used?.has(name)),
		);
		const unused = [...new Set(exports.names)]
			.filter(
				(name) =>
					!used?.has(name) &&
					!waiting.includes(name) &&
					(values.has(name) || !reached.has(name)),
			)
			.sort();
		const list = (names: string[]) => names.map((n) => `"${n}"`).join(", ");
		const onlyTests = unused.filter((n) => tested.get(entry.file)?.has(n));
		const none = unused.filter((n) => !onlyTests.includes(n));
		if (none.length) {
			problems.push(
				`${rel(entry.file)}: no other workspace imports ${list(none)} from "${entry.specifier}". Take ${none.length === 1 ? "it" : "them"} off the entry.`,
			);
		}
		if (onlyTests.length) {
			problems.push(
				`${rel(entry.file)}: only tests of other workspaces import ${list(onlyTests)} from "${entry.specifier}". Move ${onlyTests.length === 1 ? "it" : "them"} to "${entry.pkg}/testing", or take ${onlyTests.length === 1 ? "it" : "them"} off the entry.`,
			);
		}
	}
	return problems;
}
