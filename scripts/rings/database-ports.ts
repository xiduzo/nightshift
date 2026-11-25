/**
 * A port of the database has one adapter, over drizzle (H7, ADR 44). A twin
 * of it is found by the port it implements, in whatever file it sits: a
 * value typed by the port that is no drizzle adapter and passes to none.
 *
 * The rule reads syntax. A value with no type of its own (an object written
 * straight in a call) is out of its reach: that needs the type checker, which
 * takes 25 seconds for the server packages.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "@typescript/typescript6";

import { isTest } from "../check-layers";
import { resolveFile } from "../verticals/resolve";
import type { Slice } from "./slices";
import {
	eachNode,
	exportedFunctions,
	type FunctionNode,
	kebab,
	treeOf,
	unwrapped,
} from "./syntax";

/** A port of the database, with the file of its types and its adapter. */
export type DatabasePort = {
	name: string;
	slice: Slice;
	/** Its `application/ports.ts`. */
	types: string;
	/** The file name of its adapter: `drizzle-schedule-log.ts`. */
	adapter: string;
};

const DRIZZLE = /(?:^|\/)adapters\/out\/drizzle-[^/]*\.ts$/;
const isDrizzleAdapter = (path: string) => {
	const file = path.split(sep).join("/");
	return DRIZZLE.test(file) && !isTest(file);
};

/** The ports of the database of a slice (not of its sub-verticals): what its drizzle adapters give back. */
export function databasePortsOf(slice: Slice): DatabasePort[] {
	const out = join(slice.dir, "adapters", "out");
	const types = join(slice.dir, "application", "ports.ts");
	if (!existsSync(out) || !existsSync(types)) return [];
	return readdirSync(out)
		.sort()
		.filter((file) => isDrizzleAdapter(join(out, file)))
		.flatMap((adapter) => {
			const path = join(out, adapter);
			const ported = importedNames(path, (from) => from === types);
			return [...exportedFunctions(path).values()].flatMap(({ type }) => {
				const given =
					type && ts.isTypeReferenceNode(type) && type.typeName.getText();
				const name = given && ported.get(given);
				return name ? [{ name, slice, types, adapter }] : [];
			});
		});
}

/** The names `path` imports of the files that `wanted` takes, by their local name. */
function importedNames(
	path: string,
	wanted: (file: string, name: string) => boolean,
): Map<string, string> {
	const found = new Map<string, string>();
	for (const statement of treeOf(path).statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier)
		)
			continue;
		const specifier = statement.moduleSpecifier.text;
		const file = specifier.startsWith(".")
			? resolveFile(resolve(dirname(path), specifier))
			: specifier;
		const named = statement.importClause?.namedBindings;
		if (!file || !named || !ts.isNamedImports(named)) continue;
		for (const { name, propertyName } of named.elements) {
			const imported = (propertyName ?? name).text;
			if (wanted(file, imported)) found.set(name.text, imported);
		}
	}
	return found;
}

/** `file` gives the types of the port: its `ports.ts`, or a barrel above that. */
const givesPort = (file: string, port: DatabasePort) =>
	file === port.types ||
	(/[\\/]index\.ts$/.test(file) &&
		port.types.startsWith(dirname(file) + sep)) ||
	file === `@nightshift/${port.slice.pkg}`;

/** A type made of its first argument: the value has the members of that. */
const OF_ITS_ARGUMENT =
	/^(?:Awaited|Omit|Partial|Pick|Promise|Readonly|Required|ReturnType)$/;

/** The value is typed by one of `names`: a port, or an adapter whose `typeof` it has. */
function typedBy(
	type: ts.Node | undefined,
	names: ReadonlyMap<string, DatabasePort>,
	declared: ReadonlyMap<string, ts.TypeNode>,
	seen = new Set<string>(),
): DatabasePort | undefined {
	const by = (inner: ts.Node | undefined) =>
		typedBy(inner, names, declared, seen);
	const first = (inner: readonly ts.Node[]) => inner.map(by).find(Boolean);
	if (!type) return undefined;
	if (ts.isTypeQueryNode(type))
		return names.get(`typeof ${type.exprName.getText()}`);
	if (ts.isParenthesizedTypeNode(type)) return by(type.type);
	if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type))
		return first(type.types);
	if (ts.isFunctionTypeNode(type)) return by(type.type);
	if (!ts.isTypeReferenceNode(type)) return undefined;
	const name = type.typeName.getText();
	if (OF_ITS_ARGUMENT.test(name)) return by(type.typeArguments?.[0]);
	const alias = declared.get(name);
	if (alias && !seen.has(name)) {
		seen.add(name);
		return by(alias);
	}
	return names.get(name);
}

/** What a function gives back: its expression body, and its own `return`s. */
function resultsOf({ body }: { body?: ts.Node }): ts.Expression[] {
	if (!body) return [];
	if (!ts.isBlock(body)) return [body as ts.Expression];
	const found: ts.Expression[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionLike(node)) return;
		if (ts.isReturnStatement(node) && node.expression)
			found.push(node.expression);
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(body, visit);
	return found;
}

const isFunction = (node: ts.Node): node is FunctionNode =>
	ts.isFunctionDeclaration(node) ||
	ts.isFunctionExpression(node) ||
	ts.isArrowFunction(node);

/** The declaration of `name` that `from` sees, in its own file. */
function declarationOf(
	name: string,
	from: ts.Node,
): ts.VariableDeclaration | ts.FunctionDeclaration | undefined {
	for (let scope = from.parent; scope; scope = scope.parent) {
		if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
		for (const statement of scope.statements) {
			if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
				return statement;
			if (!ts.isVariableStatement(statement)) continue;
			for (const declaration of statement.declarationList.declarations)
				if (declaration.name.getText() === name) return declaration;
		}
	}
	return undefined;
}

type Made = ts.ObjectLiteralExpression | ts.ClassLikeDeclaration;

/** The objects an expression gives, as far as its own file says: written there, by name, or by a call of a function there. */
function madeBy(value: ts.Node, seen = new Set<ts.Node>()): Made[] {
	if (seen.has(value)) return [];
	seen.add(value);
	const by = (inner: ts.Node) => madeBy(inner, seen);
	if (isFunction(value)) return resultsOf(value).flatMap(by);
	const inner = unwrapped(value as ts.Expression);
	if (ts.isObjectLiteralExpression(inner)) return [inner];
	if (isFunction(inner)) return by(inner);
	if (ts.isConditionalExpression(inner))
		return [...by(inner.whenTrue), ...by(inner.whenFalse)];
	if (ts.isCallExpression(inner)) return by(inner.expression);
	if (!ts.isIdentifier(inner)) return [];
	const declaration = declarationOf(inner.text, inner);
	if (!declaration) return [];
	if (ts.isFunctionDeclaration(declaration)) return by(declaration);
	return declaration.initializer ? by(declaration.initializer) : [];
}

/** Each object of a file that a type of it names, with that type. */
function typedObjects(tree: ts.SourceFile): { made: Made; type: ts.Node }[] {
	const found: { made: Made; type: ts.Node }[] = [];
	const add = (type: ts.Node | undefined, value: ts.Node | undefined) => {
		if (type && value)
			for (const made of madeBy(value)) found.push({ made, type });
	};
	eachNode(tree, (node) => {
		if (
			ts.isVariableDeclaration(node) ||
			ts.isParameter(node) ||
			ts.isPropertyDeclaration(node)
		)
			add(node.type, node.initializer);
		else if (ts.isSatisfiesExpression(node) || ts.isAsExpression(node))
			add(node.type, node.expression);
		else if (isFunction(node) || ts.isMethodDeclaration(node))
			for (const result of resultsOf(node)) add(node.type, result);
		else if (ts.isClassLike(node))
			for (const clause of node.heritageClauses ?? [])
				if (clause.token === ts.SyntaxKind.ImplementsKeyword)
					for (const type of clause.types)
						found.push({
							made: node,
							type: ts.factory.createTypeReferenceNode(
								type.expression as ts.Identifier,
								type.typeArguments,
							),
						});
	});
	return found;
}

/**
 * The names of a file that reach a drizzle adapter: an import of one or of a
 * `test-support.ts`, a parameter typed by the port, and what is made of those.
 */
function realNames(
	tree: ts.SourceFile,
	isPort: (type: ts.Node | undefined) => boolean,
): Set<string> {
	const real = new Set(
		importedNames(
			tree.fileName,
			(file) => isDrizzleAdapter(file) || /[\\/]test-support\.ts$/.test(file),
		).keys(),
	);
	const made: { name: ts.Node; of: ts.Node }[] = [];
	eachNode(tree, (node) => {
		if (ts.isParameter(node) && isPort(node.type))
			real.add(node.name.getText());
		if (ts.isVariableDeclaration(node) && node.initializer)
			made.push({ name: node.name, of: node.initializer });
		if (ts.isFunctionDeclaration(node) && node.name && node.body)
			made.push({ name: node.name, of: node.body });
	});
	for (let size = -1; size !== real.size; ) {
		size = real.size;
		for (const { name, of } of made)
			if (names(of, real))
				eachNode(name, (inner) => {
					if (ts.isIdentifier(inner)) real.add(inner.text);
				});
	}
	return real;
}

/** `node` names one of `real`: not as a member of another thing. */
function names(node: ts.Node, real: ReadonlySet<string>): boolean {
	let found = false;
	eachNode(node, (inner) => {
		if (!ts.isIdentifier(inner) || !real.has(inner.text)) return;
		const { parent } = inner;
		if (
			(ts.isPropertyAccessExpression(parent) ||
				ts.isPropertyAssignment(parent) ||
				ts.isMethodDeclaration(parent)) &&
			parent.name === inner
		)
			return;
		found = true;
	});
	return found;
}

/** The object passes to a drizzle adapter: it extends one, spreads a thing that is no object of this file, or each member names one. */
function passes(made: Made, real: ReadonlySet<string>): boolean {
	if (ts.isClassLike(made))
		return (
			(made.heritageClauses ?? []).some(
				({ token, types }) =>
					token === ts.SyntaxKind.ExtendsKeyword &&
					types.some((type) => names(type, real)),
			) ||
			made.members
				.filter((member) => ts.isMethodDeclaration(member))
				.every((member) => names(member, real))
		);
	const spreads = made.properties.some(
		(property) =>
			ts.isSpreadAssignment(property) && !madeBy(property.expression).length,
	);
	return (
		spreads ||
		(made.properties.length > 0 &&
			made.properties.every((property) => names(property, real)))
	);
}

/**
 * The twins of `ports` in `files`, as messages: a value typed by a port of
 * the database that is no drizzle adapter, and passes to none.
 */
export function databaseTwins(
	root: string,
	ports: readonly DatabasePort[],
	files: readonly string[],
): string[] {
	const problems: string[] = [];
	const anyPort = new RegExp(
		[...ports.map(({ name }) => name), "/drizzle-"].join("|"),
	);
	for (const path of files) {
		if (isDrizzleAdapter(path)) continue;
		// A parse of every file costs seconds: few name a port.
		if (!anyPort.test(readFileSync(path, "utf8"))) continue;
		const named = new Map<string, DatabasePort>();
		const found = new Map<string, DatabasePort>();
		for (const port of ports) {
			const out = join(port.slice.dir, "adapters", "out");
			if (path === join(out, `in-memory-${kebab(port.name)}.ts`))
				found.set(port.name, port);
			const types = importedNames(
				path,
				(file, name) => name === port.name && givesPort(file, port),
			);
			for (const local of types.keys()) named.set(local, port);
			const adapters = importedNames(
				path,
				(file) => file === join(out, port.adapter),
			);
			for (const local of adapters.keys()) named.set(`typeof ${local}`, port);
		}
		if (!named.size && !found.size) continue;
		const tree = treeOf(path);
		const declared = new Map<string, ts.TypeNode>();
		for (const statement of tree.statements)
			if (ts.isTypeAliasDeclaration(statement))
				declared.set(statement.name.text, statement.type);
		const portOf = (type: ts.Node | undefined) =>
			typedBy(type, named, declared);
		const real = realNames(tree, (type) => portOf(type) !== undefined);
		for (const { made, type } of typedObjects(tree)) {
			const port = portOf(type);
			if (port && !passes(made, real)) found.set(port.name, port);
		}
		const file = relative(root, path).split(sep).join("/");
		for (const { name, adapter } of found.values())
			problems.push(
				`${file}: ${name} is a port of the database, so it has no in-memory adapter. Its use-case tests run on ${adapter}, over migratedDb() of @nightshift/db/testing (ADR 44). To change one member for a test, spread the real adapter and write that member.`,
			);
	}
	return problems;
}

/** The contract suites in `adapters/out/` that have the name of a port of the database or import its type, as messages. */
export function databaseSuites(
	root: string,
	ports: readonly DatabasePort[],
): string[] {
	return ports.flatMap((port) => {
		const out = join(port.slice.dir, "adapters", "out");
		return readdirSync(out)
			.sort()
			.filter((name) => /\.contract(?:\.test)?\.ts$/.test(name))
			.filter(
				(name) =>
					name.startsWith(`${kebab(port.name)}.contract.`) ||
					importedNames(
						join(out, name),
						(file, imported) => imported === port.name && givesPort(file, port),
					).size > 0,
			)
			.map(
				(name) =>
					`${relative(root, join(out, name)).split(sep).join("/")}: ${port.name} has one adapter, so it has no contract suite. Move the tests to ${port.adapter.replace(/\.ts$/, ".test.ts")}.`,
			);
	});
}
