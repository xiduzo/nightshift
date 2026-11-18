/**
 * The source files of a workspace and what each one imports and exports.
 * `scripts/check-verticals.ts` and the checks beside it read every rule
 * from this one parse.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "@typescript/typescript6";

/** Folders that hold no source, anywhere: installs and build output. */
const SKIP_DIRS = new Set(["node_modules", "dist"]);

/**
 * Folders at the top of a workspace that hold no source of its own: build
 * output, and the native projects that Expo makes.
 */
const SKIP_TOP_DIRS = new Set(["build", "ios", "android"]);

/** A folder the walk skips: an install, build output, or a dot folder. */
export const skipped = (name: string) =>
	SKIP_DIRS.has(name) || name.startsWith(".");

export type Import = {
	specifier: string;
	/** The names it uses, or "all" (namespace, `export *`, plain `import()`). */
	names: string[] | "all";
};

export type SourceFile = {
	path: string;
	test: boolean;
	imports: Import[];
	exports: { names: string[]; stars: string[] };
	/** Every statement is an import or an export of names (rule j). */
	onlyImportsAndExports: boolean;
	/**
	 * The names it exports as values (m). `verbatimModuleSyntax` makes a
	 * type export say `type`, so the syntax tells them apart.
	 */
	values: Set<string>;
	/** `export { imported as exported } from "specifier"`. */
	reexports: { specifier: string; imported: string; exported: string }[];
	/** `export { local as exported }` of a name it imports. */
	localExports: { local: string; exported: string }[];
	/** Each imported name by its local name (`*` for a namespace). */
	bindings: Map<string, { specifier: string; imported: string }>;
};

/**
 * The files to check under `dir` (a workspace when `top`), in name order on
 * every file system.
 */
export function walk(dir: string, out: string[], top = false): void {
	if (!existsSync(dir)) return;
	const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	);
	for (const entry of entries) {
		if (
			entry.isDirectory() &&
			(skipped(entry.name) || (top && SKIP_TOP_DIRS.has(entry.name)))
		)
			continue;
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

/** `import("x").A.B`: the name A. A plain `import("x")` uses every name. */
function typeReference(node: ts.ImportTypeNode): string[] | "all" {
	let qualifier = node.qualifier;
	if (!qualifier) return "all";
	while (ts.isQualifiedName(qualifier)) qualifier = qualifier.left;
	return [qualifier.text];
}

/** An import or an export of names: what a barrel may hold (rule j). */
function importOrExport(statement: ts.Statement): boolean {
	return (
		ts.isImportDeclaration(statement) ||
		ts.isExportDeclaration(statement) ||
		(ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression))
	);
}

/** Each file parsed once, for every rule and every workspace. */
const parsed = new Map<string, SourceFile>();

export function parse(path: string): SourceFile {
	const cached = parsed.get(path);
	if (cached) return cached;
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
	const values = new Set<string>();
	const reexports: SourceFile["reexports"] = [];
	const localExports: SourceFile["localExports"] = [];
	const bindings: SourceFile["bindings"] = new Map();
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
			const specifier = node.moduleSpecifier.text;
			const clause = node.importClause;
			imports.push({ specifier, names: bindingNames(clause) });
			if (clause?.name)
				bindings.set(clause.name.text, { specifier, imported: "default" });
			const named = clause?.namedBindings;
			if (named && ts.isNamespaceImport(named))
				bindings.set(named.name.text, { specifier, imported: "*" });
			else if (named && ts.isNamedImports(named))
				for (const element of named.elements)
					bindings.set(element.name.text, {
						specifier,
						imported: (element.propertyName ?? element.name).text,
					});
		} else if (ts.isExportDeclaration(node)) {
			const clause = node.exportClause;
			const valueElement = (e: ts.ExportSpecifier) =>
				!node.isTypeOnly && !e.isTypeOnly;
			if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				const specifier = node.moduleSpecifier.text;
				if (!clause) {
					imports.push({ specifier, names: "all" });
					stars.push(specifier);
				} else if (ts.isNamespaceExport(clause)) {
					imports.push({ specifier, names: "all" });
					exportNames.push(clause.name.text);
					if (!node.isTypeOnly) values.add(clause.name.text);
					reexports.push({
						specifier,
						imported: "*",
						exported: clause.name.text,
					});
				} else {
					imports.push({
						specifier,
						names: clause.elements.map((e) => (e.propertyName ?? e.name).text),
					});
					for (const e of clause.elements) {
						exportNames.push(e.name.text);
						if (valueElement(e)) values.add(e.name.text);
						reexports.push({
							specifier,
							imported: (e.propertyName ?? e.name).text,
							exported: e.name.text,
						});
					}
				}
			} else if (clause && ts.isNamedExports(clause)) {
				for (const e of clause.elements) {
					exportNames.push(e.name.text);
					if (valueElement(e)) values.add(e.name.text);
					localExports.push({
						local: (e.propertyName ?? e.name).text,
						exported: e.name.text,
					});
				}
			}
		} else if (ts.isExportAssignment(node)) {
			exportNames.push("default");
			values.add("default");
		} else if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) &&
					node.expression.text === "require")) &&
			node.arguments[0] &&
			ts.isStringLiteralLike(node.arguments[0])
		) {
			imports.push({
				specifier: node.arguments[0].text,
				names: destructured(node),
			});
		} else if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteral(node.argument.literal)
		) {
			imports.push({
				specifier: node.argument.literal.text,
				names: typeReference(node),
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
			if (isDefault) {
				exportNames.push("default");
				values.add("default");
			} else if (ts.isVariableStatement(node)) {
				for (const declaration of node.declarationList.declarations) {
					if (ts.isIdentifier(declaration.name)) {
						exportNames.push(declaration.name.text);
						values.add(declaration.name.text);
					}
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
				if (
					!ts.isInterfaceDeclaration(node) &&
					!ts.isTypeAliasDeclaration(node)
				)
					values.add(node.name.text);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	const file: SourceFile = {
		path,
		test: false,
		imports,
		exports: { names: exportNames, stars },
		onlyImportsAndExports: source.statements.every(importOrExport),
		values,
		reexports,
		localExports,
		bindings,
	};
	parsed.set(path, file);
	return file;
}
