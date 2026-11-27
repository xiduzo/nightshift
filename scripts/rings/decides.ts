/**
 * A use case decides (ADR 41): it is no forward of one port call, it reads
 * its `Actor`, its ports come from `ports.ts`, and its test asserts an
 * outcome and names no database (H6, H8). A contract suite asserts, and a
 * twin takes no code of a real adapter (H7). These rules read the body of a file.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "@typescript/typescript6";

import { isTest } from "../check-layers";
import { parse } from "../verticals/source-file";
import type { Slice } from "./slices";
import {
	asFunction,
	camel,
	eachNode,
	expected,
	exportedFunctions,
	type FunctionNode,
	treeOf,
	unwrapped,
	valueImports,
} from "./syntax";

/** The names a parameter binds. */
function bound(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text];
	return name.elements.flatMap((element) =>
		ts.isBindingElement(element) ? bound(element.name) : [],
	);
}

/** The one expression a function gives: its body, or the one statement of it. */
function resultOf(fn: FunctionNode): ts.Expression | undefined {
	const { body } = fn;
	if (!body) return undefined;
	if (!ts.isBlock(body)) return unwrapped(body);
	const [first, second, ...rest] = body.statements;
	if (!first || rest.length) return undefined;
	if (!second) {
		if (ts.isReturnStatement(first) || ts.isExpressionStatement(first))
			return first.expression && unwrapped(first.expression);
		return undefined;
	}
	// `const found = await ports.x.y(id); return found;`
	if (!ts.isVariableStatement(first) || !ts.isReturnStatement(second))
		return undefined;
	const [only, ...others] = first.declarationList.declarations;
	const kept =
		only && ts.isIdentifier(only.name) && !others.length ? only : undefined;
	const answer = second.expression && unwrapped(second.expression);
	return kept?.initializer &&
		answer &&
		ts.isIdentifier(answer) &&
		answer.text === (kept.name as ts.Identifier).text
		? unwrapped(kept.initializer)
		: undefined;
}

/** `node` is one of `names`, or a field of one. */
function isFieldOf(node: ts.Expression, names: ReadonlySet<string>): boolean {
	let root = unwrapped(node);
	while (ts.isPropertyAccessExpression(root)) root = unwrapped(root.expression);
	return ts.isIdentifier(root) && names.has(root.text);
}

/** `node` is of the request as it is: a parameter, a field of one, or an object or a list of those. */
function isOfRequest(node: ts.Expression, names: ReadonlySet<string>): boolean {
	const value = unwrapped(node);
	if (ts.isArrayLiteralExpression(value))
		return value.elements.length > 0 && value.elements.every(passes);
	if (ts.isObjectLiteralExpression(value))
		return (
			value.properties.length > 0 &&
			value.properties.every((property) => {
				if (ts.isShorthandPropertyAssignment(property))
					return names.has(property.name.text);
				if (ts.isSpreadAssignment(property)) return passes(property.expression);
				return (
					ts.isPropertyAssignment(property) && passes(property.initializer)
				);
			})
		);
	return isFieldOf(value, names);

	function passes(inner: ts.Expression): boolean {
		return isOfRequest(
			ts.isSpreadElement(inner) ? inner.expression : inner,
			names,
		);
	}
}

/**
 * The use case hands its request to one port call and does nothing else.
 * An `actor` in the call is no request: the port then decides who may act.
 */
function isForward(useCase: FunctionNode): boolean {
	const [portsParameter] = useCase.parameters;
	if (!portsParameter) return false;
	const ports = new Set(bound(portsParameter.name));
	const request = new Set<string>();
	const add = (parameters: readonly ts.ParameterDeclaration[]) => {
		for (const parameter of parameters)
			if (!isActor(parameter))
				for (const name of bound(parameter.name)) request.add(name);
	};
	add(useCase.parameters.slice(1));
	let result = resultOf(useCase);
	let inner = asFunction(result);
	while (inner) {
		add(inner.parameters);
		result = resultOf(inner);
		inner = asFunction(result);
	}
	if (!result) return false;
	// `(ports) => ports.store.find`: the call itself.
	if (ts.isPropertyAccessExpression(result)) return isFieldOf(result, ports);
	return (
		ts.isCallExpression(result) &&
		isFieldOf(result.expression, ports) &&
		result.arguments.every((argument) =>
			isOfRequest(
				ts.isSpreadElement(argument) ? argument.expression : argument,
				request,
			),
		)
	);
}

/** A parameter of type `Actor`, or of that name. */
function isActor(parameter: ts.ParameterDeclaration): boolean {
	const { name, type } = parameter;
	return (
		(ts.isIdentifier(name) && /^_*actor$/.test(name.text)) ||
		(type !== undefined &&
			ts.isTypeReferenceNode(type) &&
			type.typeName.getText() === "Actor")
	);
}

/** The names of the `Actor` parameters in a file that nothing reads. */
function unreadActors(path: string): string[] {
	const found: string[] = [];
	eachNode(treeOf(path), (node) => {
		if (!ts.isParameter(node) || !isActor(node)) return;
		const fn = node.parent;
		if (!("body" in fn) || !fn.body) return;
		const names = new Set(bound(node.name));
		let read = false;
		eachNode(fn.body as ts.Node, (inner) => {
			if (
				ts.isIdentifier(inner) &&
				names.has(inner.text) &&
				!ts.isVoidExpression(inner.parent) &&
				!(
					ts.isPropertyAccessExpression(inner.parent) &&
					inner.parent.name === inner
				) &&
				!(ts.isPropertyAssignment(inner.parent) && inner.parent.name === inner)
			)
				read = true;
		});
		const underscored = [...names].some((name) => name.startsWith("_"));
		if (!read || underscored) found.push([...names].join(", "));
	});
	return found;
}

/** `value` is a `typeof`, or compares one. */
function isTypeOf(value: ts.Expression): boolean {
	if (ts.isBinaryExpression(value))
		return isTypeOf(unwrapped(value.left)) || isTypeOf(unwrapped(value.right));
	return ts.isTypeOfExpression(value);
}

/** A test file asserts an outcome: an `expect` of more than a `typeof` or of the function `named` itself. */
export function assertsOutcome(test: string, named?: string): boolean {
	return expected(test).some((argument) => {
		if (!argument) return false;
		const value = unwrapped(argument);
		return (
			!isTypeOf(value) && !(ts.isIdentifier(value) && value.text === named)
		);
	});
}

/** A text that names a member: `ports["db"]`, or `{ "db": rows }` of a binding. */
function isMemberName(node: ts.Node): node is ts.StringLiteralLike {
	const { parent } = node;
	return (
		ts.isStringLiteralLike(node) &&
		((ts.isElementAccessExpression(parent) &&
			parent.argumentExpression === node) ||
			ts.isComputedPropertyName(parent) ||
			(ts.isBindingElement(parent) && parent.propertyName === node))
	);
}

/** A test names the handle of a database: `db` or `database`. */
function namesDatabase(test: string): boolean {
	let found = false;
	eachNode(treeOf(test), (node) => {
		const text = ts.isIdentifier(node) || isMemberName(node) ? node.text : "";
		if (/^(?:db|database)$/.test(text)) found = true;
	});
	return found;
}

/** A type holds a function or a method. */
function holdsFunction(type: ts.Node): boolean {
	let found = false;
	eachNode(type, (node) => {
		if (ts.isFunctionTypeNode(node) || ts.isMethodSignature(node)) found = true;
	});
	return found;
}

/** The types a file declares, by name. */
function declaredTypes(
	path: string,
): Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration> {
	const declared = new Map<
		string,
		ts.TypeAliasDeclaration | ts.InterfaceDeclaration
	>();
	for (const statement of treeOf(path).statements)
		if (
			ts.isTypeAliasDeclaration(statement) ||
			ts.isInterfaceDeclaration(statement)
		)
			declared.set(statement.name.text, statement);
	return declared;
}

/** A request of the use case has the property `actor`: in its type there, or in a type of the same file. */
function requestHasActor(path: string, useCase: FunctionNode): boolean {
	const declared = declaredTypes(path);
	const seen = new Set<string>();
	const has = (type: ts.Node | undefined): boolean => {
		if (!type) return false;
		if (ts.isTypeAliasDeclaration(type)) return has(type.type);
		if (ts.isTypeLiteralNode(type) || ts.isInterfaceDeclaration(type))
			return type.members.some((member) => member.name?.getText() === "actor");
		if (ts.isIntersectionTypeNode(type)) return type.types.some(has);
		if (!ts.isTypeReferenceNode(type)) return false;
		const name = type.typeName.getText();
		if (seen.has(name)) return false;
		seen.add(name);
		return has(declared.get(name));
	};
	let found = false;
	eachNode(useCase, (node) => {
		if (
			ts.isParameter(node) &&
			node !== useCase.parameters[0] &&
			"body" in node.parent &&
			has(node.type)
		)
			found = true;
	});
	return found;
}

/**
 * The ports a use case file declares itself: each type of the file that a
 * member of the use case's first argument names, and that holds a function.
 */
function ownPorts(path: string, useCase: FunctionNode): string[] {
	const declared = declaredTypes(path);
	const found = new Set<string>();
	const seen = new Set<string>();
	const visit = (node: ts.Node, member: boolean): void => {
		if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
			const name = node.typeName.text;
			const type = declared.get(name);
			if (type && !seen.has(name)) {
				if (member && holdsFunction(type)) found.add(name);
				seen.add(name);
				visit(type, member);
			}
		}
		const inside = member || ts.isTypeElement(node);
		ts.forEachChild(node, (child) => visit(child, inside));
	};
	const bag = useCase.parameters[0]?.type;
	if (bag) visit(bag, false);
	return [...found].sort();
}

/** What breaks "a use case decides" in the `application/` of one slice. */
export function decisionOffences(root: string, slice: Slice): string[] {
	const rel = (path: string) => relative(root, path).split(sep).join("/");
	const offences: string[] = [];
	for (const { path, name, fn } of useCasesOf(slice)) {
		const file = rel(path);
		if (isForward(fn))
			offences.push(
				`${file}: passes its request to one port call and decides nothing. The wire.ts of the slice gives that call.`,
			);
		for (const actor of unreadActors(path))
			offences.push(
				`${file}: takes the actor (${actor}) and does not read it. Ask who may act, or take no actor.`,
			);
		if (requestHasActor(path, fn))
			offences.push(
				`${file}: has the actor in its request. The actor is an argument of its own, before the request (P3).`,
			);
		for (const port of ownPorts(path, fn))
			offences.push(
				`${file}: declares the port ${port}. A port sits in application/ports.ts, with its adapters.`,
			);
		const test = path.replace(/\.ts$/, ".test.ts");
		if (existsSync(test) && !assertsOutcome(test, name))
			offences.push(
				`${rel(test)}: asserts no outcome of ${name}. Expect what it returns, refuses or changes.`,
			);
		if (existsSync(test) && namesDatabase(test))
			offences.push(
				`${rel(test)}: names the database. A use-case test reaches it only through a port: give the rows a function of test-support.ts.`,
			);
	}
	const out = join(slice.dir, "adapters", "out");
	for (const name of existsSync(out) ? readdirSync(out).sort() : []) {
		const path = join(out, name);
		const file = rel(path);
		if (name.endsWith(".contract.ts") && !assertsOutcome(path))
			offences.push(
				`${file}: a contract suite without an expect() proves nothing. Expect what the port gives.`,
			);
		if (!/^in-memory-.*(?<!\.test)\.ts$/.test(name)) continue;
		for (const target of valueImports(path))
			if (isRealAdapter(target))
				offences.push(
					`${file}: takes code of a real adapter (${rel(target)}). The contract suite then runs that code twice. Move a value that both need to domain/.`,
				);
	}
	return offences;
}

/** A file of `adapters/out/` that is not test code (H5). */
const isRealAdapter = (path: string): boolean => {
	const file = path.split(sep).join("/");
	return file.includes("/adapters/out/") && !isTest(file);
};

type UseCase = { path: string; name: string; fn: FunctionNode };

/** The use cases of one slice (not of its sub-verticals) that are written as a function. */
function useCasesOf(slice: Slice): UseCase[] {
	const dir = join(slice.dir, "application");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((file) => /^(?!ports\.ts$).*(?<!\.test)\.ts$/.test(file))
		.sort()
		.flatMap((file) => {
			const path = join(dir, file);
			const name = camel(file.slice(0, -".ts".length));
			const fn = exportedFunctions(path).get(name);
			return fn ? [{ path, name, fn }] : [];
		});
}

/** The ports of one slice that a use case of it reads and decides on: no forward counts. */
export function readPorts(slice: Slice): Set<string> {
	return new Set(
		useCasesOf(slice).flatMap(({ path, fn }) =>
			isForward(fn)
				? []
				: parse(path).imports.flatMap((imported) =>
						imported.specifier === "./ports" && imported.names !== "all"
							? imported.names
							: [],
					),
		),
	);
}
