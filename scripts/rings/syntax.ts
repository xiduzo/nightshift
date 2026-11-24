/**
 * The syntax trees the file rules read (H6, H7), and what they ask of one:
 * its exported functions, its value imports and its calls of `expect`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import ts from "@typescript/typescript6";

import { resolveFile } from "../verticals/resolve";

/** `answer-gate` is `answerGate`. */
export const camel = (name: string): string =>
	name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

const trees = new Map<string, ts.SourceFile>();

/** The syntax tree of a file, parsed once. */
export function treeOf(path: string): ts.SourceFile {
	const known = trees.get(path);
	if (known) return known;
	const text = readFileSync(path, "utf8");
	const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	trees.set(path, tree);
	return tree;
}

/** Calls `visit` on `node` and on everything below it. */
export function eachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
	visit(node);
	ts.forEachChild(node, (child) => eachNode(child, visit));
}

/** `value`, without what changes no value: parentheses, `as`, `satisfies`, `!` and `await`. */
export function unwrapped(value: ts.Expression): ts.Expression {
	let inner = value;
	while (
		ts.isParenthesizedExpression(inner) ||
		ts.isAsExpression(inner) ||
		ts.isSatisfiesExpression(inner) ||
		ts.isNonNullExpression(inner) ||
		ts.isAwaitExpression(inner)
	)
		inner = inner.expression;
	return inner;
}

/** A function with a body: a declaration, an arrow function or a function expression. */
export type FunctionNode =
	| ts.FunctionDeclaration
	| ts.FunctionExpression
	| ts.ArrowFunction;

export const asFunction = (
	value: ts.Expression | undefined,
): ts.FunctionExpression | ts.ArrowFunction | undefined => {
	const inner = value && unwrapped(value);
	return inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))
		? inner
		: undefined;
};

/**
 * The functions a file exports, by name: a function declaration, or a
 * constant whose value is an arrow function or a function expression.
 */
export function exportedFunctions(path: string): Map<string, FunctionNode> {
	const exported = (node: ts.HasModifiers) =>
		(ts.getModifiers(node) ?? []).some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		);
	const found = new Map<string, FunctionNode>();
	for (const statement of treeOf(path).statements) {
		if (ts.isFunctionDeclaration(statement) && exported(statement)) {
			if (statement.name) found.set(statement.name.text, statement);
		} else if (ts.isVariableStatement(statement) && exported(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				const value = asFunction(declaration.initializer);
				if (ts.isIdentifier(declaration.name) && value)
					found.set(declaration.name.text, value);
			}
		}
	}
	return found;
}

/** The files of which `path` imports a value, by a relative path. A type-only import does not count. */
export function valueImports(path: string): string[] {
	return treeOf(path).statements.flatMap((statement) => {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			!statement.moduleSpecifier.text.startsWith(".")
		)
			return [];
		const clause = statement.importClause;
		const named = clause?.namedBindings;
		const types =
			clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
			(clause &&
				!clause.name &&
				named &&
				ts.isNamedImports(named) &&
				named.elements.every((element) => element.isTypeOnly));
		const file = resolveFile(
			resolve(dirname(path), statement.moduleSpecifier.text),
		);
		return types || !file ? [] : [file];
	});
}

/** The first argument of each call of `expect` in a file, in order. */
export function expected(path: string): (ts.Expression | undefined)[] {
	const found: (ts.Expression | undefined)[] = [];
	eachNode(treeOf(path), (node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "expect"
		)
			found.push(node.arguments[0]);
	});
	return found;
}
